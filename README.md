# FairFit

**Hiring screening for humans, not keyword filters.**

FairFit flips broken, ATS-style candidate screening on its head. You describe the role — or just
what you're really looking for in a person — drop in a stack of CVs, and FairFit returns a
human-readable shortlist: **Favorable / Medium / Unfavorable**, each with a plain reason and the
full CV one click away. A person makes the final call. Built with the **OpenAI Agents SDK** for
the HCLTech–OpenAI Agentic AI Hackathon (Track 1/2 — recruiting operations).

## The problem

A single opening draws thousands of applicants. Keyword-matching ATS tools auto-reject at scale,
discarding strong candidates for the wrong reasons and giving recruiters a black box. The work
that matters — reading a CV against what the role actually needs — gets skipped.

## What it does

- **Understands the role**: turns a free-form brief into clear must-haves and nice-to-haves
  (including the human/soft signals you mention, not just keywords).
- **Screens each CV fairly**: looks past keywords for transferable experience and potential, and
  is instructed not to penalize for name, gender, age or background.
- **Sorts into three tiers** with a reason tailored to each: *why dig deeper* (Favorable),
  *why it could still be interesting* (Medium), *why to set aside* (Unfavorable) — plus strengths,
  gaps, and which must-haves are met vs missing.
- **Keeps a human in control**: open the full CV in one click, and **draft an email** (interview
  invite / info request / kind rejection) per candidate. It surfaces and explains; it never
  auto-rejects.

## How it works

```
role brief + CVs
   └─ RoleAgent → (for each CV) ScreenAgent → shortlist board (Favorable / Medium / Unfavorable)
      (must-haves,  (tier, reason,                       │
       nice-to-haves) strengths, gaps,    select a candidate └─► OutreachAgent (invite / info / rejection)
                      matched/missing)
```

## Tech stack

- **Backend**: Python, FastAPI, OpenAI Agents SDK; candidates stream in live over Server-Sent
  Events.
- **Frontend**: a custom triage board — three columns by recommendation, candidate cards, and a
  CV viewer modal (HTML/CSS/JS, no build step).

## Project structure

```
agents_pipeline.py        role / screen / outreach agents and models
server.py                 FastAPI app (roles, cvs, process, events/SSE, email)
web/                      index.html · style.css · app.js
synthetic_data/cvs/       10 sample CVs across roles and seniorities
```

## Getting started

You need an **OpenAI API key** (platform.openai.com — pay-as-you-go). Each screened candidate is a
small model call (cents per batch).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # set OPENAI_API_KEY
python server.py
```

Open http://127.0.0.1:8060.

## Using it

1. **The role** — pick an example (Senior Frontend Engineer, Data Scientist, Product Marketing
   Manager) to fill the brief, or write what you're looking for.
2. **The candidates** — tick sample CVs (or **Select all**), and/or upload your own CVs (many at
   once, `.txt`/`.md`).
3. Press **Screen candidates** and watch them sort live into the three columns.
4. On each card, read the reason and matched/missing requirements, click **View CV** to read the
   full CV, or **Draft email** to generate an invite, info request or kind rejection.

## Bring your own API key

No key in your `.env`? Click **Add API key** in the top bar and paste your own OpenAI key. It is
stored only in your browser (localStorage) and sent to your local server with each request; the
server falls back to its `.env` key if none is set. Never commit your key to the repo.

## Notes

CVs and roles are **synthetic**. FairFit is a decision aid that keeps a human in the loop — it
surfaces and explains candidates and does not auto-reject anyone.
