"""
FairFit - FastAPI backend.

  GET  /api/roles             -> example role briefs (quick start)
  GET  /api/cvs               -> sample candidate CVs (name + headline)
  GET  /api/cv/{name}         -> one CV's text
  POST /api/process           -> screen selected sample CVs + uploaded CVs vs a brief
  GET  /api/events/{job_id}   -> SSE: progress + per-candidate + result
  POST /api/email             -> draft an invite / info request / rejection

Run:  python server.py   (http://127.0.0.1:8060)
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, Header, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agents_pipeline import ScreenResult, draft_email, run_pipeline

load_dotenv()

ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
CVS_DIR = ROOT / "synthetic_data" / "cvs"
MAX_FILE_MB = 3
MAX_CANDIDATES = 20

app = FastAPI(title="FairFit")
JOBS: dict[str, asyncio.Queue] = {}


def apply_key(key) -> None:
    """Use a per-request OpenAI key (from the UI) if provided; else keep .env."""
    if key:
        os.environ["OPENAI_API_KEY"] = key
        try:
            from agents import set_default_openai_key
            set_default_openai_key(key)
        except Exception:
            pass

ROLE_PRESETS = [
    {"name": "Senior Frontend Engineer", "brief": (
        "We're hiring a Senior Frontend Engineer. Must have strong React and TypeScript, "
        "5+ years building production web apps, experience with design systems and "
        "accessibility, and care about UX craft. Nice to have: Next.js, testing, some "
        "backend/Node. More than a keyword match — I want someone who has owned complex "
        "UI end to end and mentors others.")},
    {"name": "Data Scientist", "brief": (
        "Looking for a Data Scientist to drive experimentation and ML in a product team. "
        "Must have Python, solid statistics, machine learning, and experience running "
        "A/B tests and shipping models that affect real decisions. Nice to have: SQL, "
        "MLOps, causal inference. I value clear communication of results to non-technical "
        "stakeholders over fancy model zoos.")},
    {"name": "Product Marketing Manager", "brief": (
        "Hiring a Product Marketing Manager for a B2B SaaS product. Must have B2B SaaS "
        "experience, product positioning and messaging, and leading go-to-market launches "
        "with sales enablement. Nice to have: competitive intelligence, analyst relations. "
        "I care most about someone who can turn a technical product into a story buyers get.")},
]


def _cv_path(name: str) -> Optional[Path]:
    safe = Path(name.strip()).name
    if not safe:
        return None
    if not safe.endswith(".txt"):
        safe += ".txt"
    candidate = (CVS_DIR / safe).resolve()
    try:
        if candidate.parent == CVS_DIR.resolve() and candidate.exists():
            return candidate
    except OSError:
        return None
    return None


def _preview(text: str) -> dict:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    name = lines[0] if lines else "Candidate"
    headline = lines[1] if len(lines) > 1 else ""
    return {"name": name, "headline": headline}


def friendly_error(e: Exception) -> str:
    low = str(e).lower()
    if "api key" in low or "api_key" in low:
        return "OpenAI API key missing or rejected. Check OPENAI_API_KEY in .env."
    if "rate limit" in low or "quota" in low:
        return "OpenAI rate limit or quota reached."
    return f"{type(e).__name__}: {e}"


def serialize(r: ScreenResult) -> dict:
    return {
        "criteria": r.criteria.model_dump(),
        "candidates": r.candidates,
        "audit_log": [asdict(e) for e in r.audit_log],
    }


async def run_job(job_id: str, brief: str, candidates: list[tuple[str, str, str]], key=None) -> None:
    q = JOBS[job_id]
    apply_key(key)

    def emit(etype: str, **kw) -> None:
        q.put_nowait({"type": etype, **kw})

    try:
        if not brief.strip():
            emit("error", message="Add a role brief first.")
            return
        if not candidates:
            emit("error", message="Add at least one CV.")
            return

        def on_progress(agent: str, status: str) -> None:
            q.put_nowait({"type": "progress", "agent": agent, "status": status})

        def on_candidate(row: dict) -> None:
            q.put_nowait({"type": "candidate", "data": row})

        result = await run_pipeline(brief, candidates, on_progress, on_candidate)
        emit("result", data=serialize(result))
    except Exception as e:  # noqa: BLE001
        emit("error", message=friendly_error(e))
    finally:
        q.put_nowait(None)


@app.get("/api/roles")
async def roles() -> JSONResponse:
    return JSONResponse(ROLE_PRESETS)


@app.get("/api/cvs")
async def cvs() -> JSONResponse:
    out = []
    for p in sorted(CVS_DIR.glob("*.txt")):
        out.append({"id": p.stem, **_preview(p.read_text(encoding="utf-8"))})
    return JSONResponse(out)


@app.get("/api/cv/{name}")
async def cv(name: str) -> JSONResponse:
    p = _cv_path(name)
    if not p:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"id": p.stem, "text": p.read_text(encoding="utf-8")})


@app.post("/api/process")
async def process(
    brief: str = Form(""),
    cvs: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    x_openai_key: str = Header(None),
) -> JSONResponse:
    candidates: list[tuple[str, str, str]] = []
    for name in [c for c in cvs.split(",") if c.strip()]:
        p = _cv_path(name)
        if p:
            text = p.read_text(encoding="utf-8")
            candidates.append((p.stem, _preview(text)["name"], text))
    for f in files:
        if f.filename:
            data = await f.read()
            if data and len(data) <= MAX_FILE_MB * 1024 * 1024:
                text = data.decode("utf-8", errors="ignore")
                candidates.append((f.filename, _preview(text)["name"], text))
    candidates = candidates[:MAX_CANDIDATES]

    job_id = uuid.uuid4().hex
    JOBS[job_id] = asyncio.Queue()
    asyncio.create_task(run_job(job_id, brief, candidates, key=x_openai_key))
    return JSONResponse({"job_id": job_id})


@app.get("/api/events/{job_id}")
async def events(job_id: str) -> StreamingResponse:
    async def stream():
        q = JOBS.get(job_id)
        if q is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'unknown job'})}\n\n"
            return
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            JOBS.pop(job_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/email")
async def email(payload: dict = Body(...), x_openai_key: str = Header(None)) -> JSONResponse:
    apply_key(x_openai_key)
    try:
        d = await draft_email(
            payload.get("role_title") or "the role",
            payload.get("candidate_name") or "Candidate",
            payload.get("cv_excerpt") or "",
            (payload.get("kind") or "invite").lower(),
        )
        return JSONResponse(d.model_dump())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": friendly_error(e)}, status_code=200)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"openai_key": bool(os.getenv("OPENAI_API_KEY"))})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8060, reload=False)
