-- Provenance review of reference records (lead-frozen 2026-11-19, src/lib/contracts/verification.ts).
-- reference_results rows are immutable, so source review is a separate append-only log.
-- A reviewer may not review a reference they imported (enforced in the API).
create table reference_reviews (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references reference_results(id),
  reviewer_id uuid not null references contributors(id),
  decision text not null check (decision in ('SOURCE_CONFIRMED', 'SOURCE_REJECTED')),
  reason text not null check (length(reason) >= 3),
  created_at timestamptz not null default now()
);
create index reference_reviews_ref_idx on reference_reviews (reference_id, created_at);

create trigger reference_reviews_immutable before update or delete on reference_reviews
  for each row execute function forbid_mutation();

alter table reference_reviews enable row level security;
