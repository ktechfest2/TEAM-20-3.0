-- Frozen contracts 2026-11-19 (src/lib/contracts/trace.ts): FLAGGED review decision and the
-- structured fields of a result revision. Revisions stay append-only (trigger from 0001).

alter table review_events drop constraint if exists review_events_decision_check;
alter table review_events
  add constraint review_events_decision_check check (decision in ('ACCEPTED', 'REJECTED', 'FLAGGED'));

alter table result_revisions
  add column if not exists extraction_mode text
    check (extraction_mode is null or extraction_mode in ('REAL_VISION', 'MANUAL', 'DEMO_FIXTURE')),
  add column if not exists polling_unit_code_on_sheet text,
  add column if not exists accredited_voters integer check (accredited_voters is null or accredited_voters >= 0),
  add column if not exists rejected_votes integer check (rejected_votes is null or rejected_votes >= 0),
  add column if not exists valid_votes integer check (valid_votes is null or valid_votes >= 0),
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  add column if not exists based_on_revision integer check (based_on_revision is null or based_on_revision >= 1),
  add column if not exists note text;

create index if not exists result_revisions_evidence_idx on result_revisions (evidence_id, revision_number);
create index if not exists review_events_evidence_idx on review_events (evidence_id, created_at);
