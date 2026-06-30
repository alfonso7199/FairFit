# FairFit — Submission & video script

## Submission form answers (copy/paste)

**Agent workflow.** FairFit is human-first candidate screening. (1) **RoleAgent** turns a free-form
brief — a job post, or just what you're looking for — into clear must-haves and nice-to-haves,
including the soft signals you mention. (2) For each CV, **ScreenAgent** reads it fairly (past
keywords, instructed not to penalize for name, gender, age or background) and assigns a **tier** —
Favorable / Medium / Unfavorable — with a tailored reason, strengths, gaps, and which must-haves
are met vs missing. (3) Candidates are grouped into a shortlist board. A human opens any full CV
and, per candidate, an **OutreachAgent** drafts an interview invite, info request or kind
rejection. FairFit surfaces and explains; it never auto-rejects.

**OpenAI technology stack.** OpenAI **Agents SDK** (Agent + Runner) with **structured outputs**
(Pydantic `output_type`); one screening pass per CV with results streamed live over SSE. Default
model GPT-4o-mini. Built with **Codex**.

---

## Video script (target 4–5 min)

### Part 1 — Pitch deck (~90 seconds)

- **[Slide 1 — Title]** "Hi, I'm ⟨name⟩. This is **FairFit** — hiring screening for humans, not
  keyword filters. Built with the OpenAI Agents SDK and Codex."
- **[Slide 2 — Problem]** "A single role draws thousands of applicants, and ATS tools auto-reject on
  keywords — discarding strong people for the wrong reasons, with no reason and no human judgment."
- **[Slide 3 — How it works]** "Here's the **agent workflow**: RoleAgent turns your brief into
  must-haves and nice-to-haves, then ScreenAgent reads each CV **fairly, past keywords**, and sorts
  candidates into three tiers with a reason. A human always makes the final call — it never
  auto-rejects."
- **[Slide 4 — What the judges see]** "You'll see a shortlist board — Favorable, Medium,
  Unfavorable — each candidate with a reason, the matched and missing requirements, and the full CV
  one click away."
- **[Slide 5 — Impact & scale]** "Minutes to a reasoned shortlist, judged on capability not
  background, with a human in control. It works for any role and your own definition of fit."

### Part 2 — Live demo (~3 minutes)

1. "I open FairFit at **localhost:8060**."
2. "First the key: I click **Add API key**, paste my own OpenAI key — anyone can run the repo. Dot
   turns green."
3. "**Step 1, the role:** I click the example **Senior Frontend Engineer**, which fills the brief —
   no typing."
4. "**Step 2, the candidates:** I hit **Select all** to screen the ten sample CVs at once — or I
   could upload my own, many at once."
5. "I click **Screen candidates**. Watch them **sort live** into the three columns as each CV is
   screened."
6. "Here's the shortlist. In **Favorable**, Ava Chen — and the card tells me **why to dig deeper**:
   strong React and TypeScript, design systems. In **Medium**, the full-stack and junior profiles,
   with why they could still be interesting. In **Unfavorable**, the backend and sales profiles,
   with why to set aside — for *this* role."
7. "I click **View CV** to read the full CV myself — a human makes the call — and **Draft email** to
   generate an interview invite for Ava, or a kind rejection for someone else. That's FairFit —
   screen like a human, at scale."
