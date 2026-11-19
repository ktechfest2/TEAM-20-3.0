# PollTrace

**Keep the photo. Trace the record.**

PollTrace is an offline-first web app for Nigerian voters, party agents and observers. It captures photos of the polling-unit result sheets posted in public, keeps the original safe on the phone even with no network, and uploads it unchanged when a connection returns. Reviewers can then check the evidence and compare figures across records.

Its core idea is **ProofTrail**: an inspectable chain of image integrity, provenance claims, human corrections, review decisions and discrepancies.

> **Built for a 48-hour hackathon. All data in this build is synthetic.** Every screen carries a DEMO DATA stamp. PollTrace is not affiliated with INEC, does not run or certify elections, and does not replace Form EC8A or official collation.

## The problem

Photos of posted result sheets end up scattered across phones, delayed by poor networks, and hard to attribute or cross-check. A screenshot can be mislabelled, duplicated or altered. A difference between two records may be a transcription mistake rather than wrongdoing. Without the original image and a record of every correction, disagreements are hard to investigate responsibly.

## What PollTrace does

1. **Capture offline.** Pick the polling unit (state → LGA → ward → code) and photograph the sheet. The original bytes, a SHA-256 fingerprint and a stable receipt number are saved in the browser (IndexedDB) before the app shows success.
2. **Sync safely.** When the network returns, the photo uploads with an idempotency key. The server re-computes the fingerprint and stores the original in private storage. A retry never creates a duplicate record, and a mismatch is flagged rather than accepted.
3. **Human-confirmed figures.** A vision model may suggest figures (when configured), but a person confirms or corrects every field. Each correction is a new revision, and earlier revisions are kept.
4. **Review and compare.** Reviewers record decisions and assess source independence. Deterministic comparison groups records per polling unit, removes exact duplicate images, and explains each result: matching, corroborated, conflicting, reference discrepancy, or inconclusive.

## Three things PollTrace will not claim

- A matching fingerprint shows a file **arrived unchanged**. It does not show that the photo is real or the result is true.
- Several matching photos are **not** several independent witnesses.
- A difference between records is a **question to check**, not proof of fraud.

## Status

| Area | State |
|---|---|
| Offline capture → local receipt → persistent queue | Working locally |
| Upload API (server re-hash, idempotent retry, 409/422 handling) | Working with the local dev store; unit-tested |
| Supabase storage adapter | Written, not yet tested against a live project |
| Extraction, review, comparison, discrepancy timeline | In progress |
| Deployment | Not deployed yet |

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · Zod · Dexie/IndexedDB · Web Crypto SHA-256 · Supabase Postgres + private Storage · Vitest · Playwright.

## Run locally

Requires Node 24+ and npm.

```bash
npm install
cp .env.example .env.local   # all values optional for local development
npm run dev                  # http://localhost:3000
```

Without Supabase credentials, uploads go to a **local dev store** under `./.data/` (gitignored). API responses label this `storageMode: "LOCAL_DEV"`, and production refuses it unless explicitly allowed.

Other scripts:

```bash
npm run typecheck
npm run lint
npm test          # Vitest unit and route tests
npm run build
npm run e2e       # Playwright
```

The database schema is in `supabase/migrations/`.

## Demo data

The registry contains one synthetic election and a few synthetic polling units (codes start with `DEMO.`). The demo scenario uses fictional figures: a witness record of Party B = 210 against a reference of 270, so the difference is +60 (reference minus witness). No real party, polling unit or witness is represented.

## Data sources

No live INEC/IReV feed, scraping or third-party data dependency is used. Any future historical dataset would be imported only after checking licence and provenance, and would never be presented as official certification.

## AI use

Built with the help of Claude Code. Vision-based figure extraction is optional, and when it runs it is always confirmed by a person. The extraction mode (real vision, manual, or demo fixture) is shown on every record. Comparison logic is deterministic and makes no AI judgement of truth.
