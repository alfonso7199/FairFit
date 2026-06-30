"""
FairFit - human-first candidate screening. You describe the role (or just what you
are really looking for); FairFit reads each CV and sorts candidates into Favorable /
Medium / Unfavorable with a plain reason for each — and a "view CV" so a human, not
a keyword filter, makes the call. Built with the OpenAI Agents SDK.

  RoleAgent     -> turns a free-form brief into must-haves / nice-to-haves
  ScreenAgent   -> reads each CV against those criteria: tier, reason, strengths, gaps
  OutreachAgent -> drafts an interview invite / info request / kind rejection

Synthetic CVs and roles. A decision aid for humans, not an automated reject machine.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from agents import Agent, Runner

load_dotenv()

MODEL = os.getenv("FAIRFIT_MODEL", "gpt-4o-mini")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RoleCriteria(BaseModel):
    title: str
    summary: str
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)


class CandidateAssessment(BaseModel):
    name: str = Field(description="Candidate name from the CV")
    headline: str = Field(description="Current role / seniority in a few words")
    tier: str = Field(description="favorable | medium | unfavorable")
    score: int = Field(ge=0, le=100, description="Overall fit 0-100")
    reason: str = Field(
        description="One or two sentences. For favorable: why it's worth a deeper look. "
        "For medium: why it could still be interesting. For unfavorable: why to set aside."
    )
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    matched: list[str] = Field(default_factory=list, description="Must-haves clearly met")
    missing: list[str] = Field(default_factory=list, description="Must-haves not evidenced")
    years_experience: Optional[str] = None


class EmailDraft(BaseModel):
    subject: str
    message: str


@dataclass
class AuditEntry:
    timestamp: str
    agent: str
    summary: str


@dataclass
class ScreenResult:
    criteria: RoleCriteria
    candidates: list[dict]
    audit_log: list[AuditEntry] = field(default_factory=list)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
def build_role_agent() -> Agent:
    return Agent(
        name="RoleAgent",
        model=MODEL,
        instructions=(
            "You turn a hiring manager's free-form brief (a job post, or just what they "
            "are really looking for) into clear screening criteria: a title, a one-line "
            "summary, the must-haves and the nice-to-haves. Keep must-haves to what truly "
            "matters; capture human/soft signals the manager mentions, not just keywords."
        ),
        output_type=RoleCriteria,
    )


def build_screen_agent() -> Agent:
    return Agent(
        name="ScreenAgent",
        model=MODEL,
        instructions=(
            "You screen ONE candidate CV against the role criteria, the way a thoughtful "
            "recruiter would — looking past keywords for transferable experience and "
            "potential, and avoiding bias. Decide a tier: 'favorable' (clearly worth a "
            "deeper look / interview), 'medium' (mixed but could be interesting, worth a "
            "second opinion), or 'unfavorable' (set aside for this role). Give a score "
            "0-100, a short human reason tailored to the tier (favorable: why to dig in; "
            "medium: why it could still be interesting; unfavorable: why to set aside), "
            "the candidate's strengths and gaps, which must-haves are clearly met vs not, "
            "and rough years of experience. Be fair: never penalize for gaps in name, "
            "gender, age or background — judge on evidence of capability."
        ),
        output_type=CandidateAssessment,
    )


def build_outreach_agent() -> Agent:
    return Agent(
        name="OutreachAgent",
        model=MODEL,
        instructions=(
            "Draft a short, warm, professional email to a candidate. Type 'invite' = "
            "invite to a first interview; 'info' = ask for one or two specific missing "
            "details; 'rejection' = a kind, respectful decline that still values their "
            "time. Reference the role and one concrete thing from their profile."
        ),
        output_type=EmailDraft,
    )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
TIER_RANK = {"favorable": 0, "medium": 1, "unfavorable": 2}


async def run_pipeline(
    brief: str,
    candidates: list[tuple[str, str, str]],  # (id, source_name, cv_text)
    on_progress: Optional[Callable[[str, str], None]] = None,
    on_candidate: Optional[Callable[[dict], None]] = None,
) -> ScreenResult:
    def notify(agent: str, status: str) -> None:
        if on_progress:
            on_progress(agent, status)

    audit: list[AuditEntry] = []

    notify("RoleAgent", "Reading the role brief...")
    criteria: RoleCriteria = (await Runner.run(build_role_agent(), input=brief)).final_output
    audit.append(AuditEntry(_now(), "RoleAgent", f"{len(criteria.must_haves)} must-haves, {len(criteria.nice_to_haves)} nice-to-haves"))

    screen_agent = build_screen_agent()
    rows: list[dict] = []
    for i, (cid, name, text) in enumerate(candidates, 1):
        notify("ScreenAgent", f"Screening ({i}/{len(candidates)}): {name}")
        a: CandidateAssessment = (await Runner.run(
            screen_agent,
            input="ROLE CRITERIA:\n" + criteria.model_dump_json() + "\n\nCANDIDATE CV:\n" + text,
        )).final_output
        row = {"id": cid, "source_name": name, "cv_text": text, **a.model_dump()}
        rows.append(row)
        if on_candidate:
            on_candidate({"id": cid, "name": a.name, "tier": a.tier, "score": a.score})

    rows.sort(key=lambda r: (TIER_RANK.get(r.get("tier", "medium"), 1), -int(r.get("score") or 0)))
    counts = {"favorable": 0, "medium": 0, "unfavorable": 0}
    for r in rows:
        counts[r.get("tier", "medium")] = counts.get(r.get("tier", "medium"), 0) + 1
    audit.append(AuditEntry(_now(), "Manager", f"Screened {len(rows)}: {counts['favorable']} favorable, {counts['medium']} medium, {counts['unfavorable']} unfavorable"))

    return ScreenResult(criteria=criteria, candidates=rows, audit_log=audit)


async def draft_email(role_title: str, candidate_name: str, cv_excerpt: str, kind: str) -> EmailDraft:
    agent = build_outreach_agent()
    prompt = (
        f"TYPE: {kind}\nROLE: {role_title}\nCANDIDATE: {candidate_name}\n\n"
        f"CANDIDATE PROFILE (excerpt):\n{cv_excerpt[:1200]}"
    )
    return (await Runner.run(agent, input=prompt)).final_output
