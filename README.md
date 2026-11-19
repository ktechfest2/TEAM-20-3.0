# PollTrace — Claude Code Development Kit

**This is a development harness, NOT a built product.** Extract the folder into a *new* PollTrace repository (keep hidden `.claude/`). Claude Code will use root `CLAUDE.md`, agents in `.claude/agents/`, skills in `.claude/skills/`, and rules in `.claude/rules/`.

## Quick start
```bash
mkdir polltrace && cd polltrace
# Copy ALL contents of this kit to this directory, including .claude/
git init
claude
```
In Claude Code: **`/kickoff`**. Alternatively paste `prompts/LEAD_ORCHESTRATOR.md` to the lead session.

Before running: have Node, npm, Git and Claude Code installed. Supabase and vision API keys are optional *at kickoff*; the lead must design a usable local/demo fallback, explicitly labelled, without claiming unavailable integrations work. For production-deployment behavior, configure a real database and storage.

## What's inside
- `CLAUDE.md`: persistent architecture/quality guardrails.
- `.claude/agents/`: 5 task-specific agents (offline-ux, evidence-backend, extraction-verification, adversarial-qa, demo-release).
- `.claude/skills/`: 7 slash-invoked procedures (`/kickoff`, `/capture-offline`, `/process-evidence`, `/verify-results`, `/red-team`, `/demo-rehearsal`, `/ship`).
- `.claude/rules/`: scoped evidence, security, UI, and test rules.
- `docs/`: product, trust model, schema and API contracts, decisions, execution plan, demo script, research references, submission materials.
- `fixtures/`: **synthetic**, labelled data for matching, discrepancy, duplicated and inconclusive cases.
- `prompts/`: lead orchestrator and parallel-session handoff.
- `.env.example`, `.gitignore`, `scripts/validate_kit.py`: setup and validation utilities.

## Three non-negotiable truths
1. Hashes show bytes have or have not changed, not that a photo is real.
2. Three matching uploads do not establish three independent witnesses.
3. A difference between a witness form and a reference is a reviewable discrepancy, not automatic fraud.

## Dataset policy
NO Dataphyte dependency. NO scraping IReV during hackathon. For the live demo default to labelled synthetic fixtures. Historical crosscheck CSVs may be used only after checking original URLs, permissions, licensing and provenance; don't confuse downstream crowd-sourced datasets with official INEC certification. See `docs/SOURCES.md`.

## Verify kit structure
`python3 scripts/validate_kit.py`

## Submission
Code repository, deployment, <=3-minute video, one-page problem brief, architecture sketch, AI-use/tool attribution. See `docs/SUBMISSION.md`.


## Impeccable is mandatory for design work
Run `bash scripts/install-impeccable.sh`, restart Claude Code, then `/impeccable init` and `/impeccable document`. The official third-party plugin is installed at setup time and is not embedded in this kit. See `DESIGN.md` and `docs/IMPECCABLE.md` for process, hook safety and quality gates. Product name **PollTrace** (two syllables).
