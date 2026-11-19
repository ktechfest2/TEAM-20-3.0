-- PollTrace initial schema. Lead-owned. Source: docs/CONTRACTS.md.
-- Times timestamptz UTC, votes integer >= 0 or null. Synthetic rows flagged.

create extension if not exists pgcrypto;

create table elections (
  id text primary key,
  name text not null,
  type text not null,
  date date not null,
  synthetic boolean not null default false
);

create table polling_units (
  id text primary key,
  registry_source text not null,
  code text not null,
  state text not null,
  lga text not null,
  ward text not null,
  name text not null,
  synthetic boolean not null default false,
  unique (registry_source, code)
);

create table contributors (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,             -- supabase auth.users id when configured
  alias text not null,
  role text not null check (role in ('CONTRIBUTOR', 'REVIEWER')),
  assurance text not null default 'UNVERIFIED',
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  client_submission_id uuid not null,
  contributor_id uuid not null references contributors(id),
  election_id text not null references elections(id),
  polling_unit_id text not null references polling_units(id),
  source_type text not null check (source_type in ('WITNESS_PHOTO', 'OBSERVER_PHOTO')),
  original_path text not null,          -- private bucket key; never public
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null,
  size_bytes integer not null check (size_bytes > 0),
  captured_at_claimed timestamptz,      -- device claim, not proof
  received_at timestamptz not null default now(),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PENDING_REVIEW', 'ACCEPTED', 'REJECTED')),
  synthetic boolean not null default false,
  unique (contributor_id, client_submission_id)
);
create index evidence_unit_idx on evidence (election_id, polling_unit_id);
create index evidence_sha_idx on evidence (sha256);

create table result_revisions (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidence(id),
  revision_number integer not null check (revision_number >= 1),
  origin text not null check (origin in ('REAL_VISION', 'MANUAL', 'DEMO_FIXTURE', 'HUMAN_CORRECTION')),
  form_type text not null default 'UNKNOWN' check (form_type in ('EC8A', 'EC60E', 'UNKNOWN')),
  raw_extraction jsonb,                 -- untrusted model/manual output, kept verbatim
  human_confirmed boolean not null default false,
  created_by uuid references contributors(id),
  created_at timestamptz not null default now(),
  unique (evidence_id, revision_number)
);

create table result_entries (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references result_revisions(id),
  party_code text not null,
  votes integer check (votes is null or votes >= 0),
  needs_review boolean not null default false,
  unique (revision_id, party_code)
);

create table review_events (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidence(id),
  reviewer_id uuid not null references contributors(id),
  decision text not null check (decision in ('ACCEPTED', 'REJECTED')),
  independence_status text not null check (independence_status in ('UNVERIFIED', 'REVIEWER_CONFIRMED', 'DISPUTED')),
  reason text not null check (length(reason) >= 3),
  created_at timestamptz not null default now()
);

create table reference_results (
  id uuid primary key default gen_random_uuid(),
  election_id text not null references elections(id),
  polling_unit_id text not null references polling_units(id),
  source_type text not null check (source_type in ('MANUAL_IREV', 'HISTORICAL_DATASET', 'SYNTHETIC_DEMO')),
  source_description text not null,
  source_url text,
  version integer not null check (version >= 1),
  figures jsonb not null,
  source_verified boolean not null default false,  -- provenance reviewed, NOT INEC-certified
  synthetic boolean not null default false,
  created_by uuid references contributors(id),
  created_at timestamptz not null default now(),
  unique (election_id, polling_unit_id, version)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid references evidence(id),
  actor_id uuid references contributors(id),
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Append-only tables: block UPDATE and DELETE at the database level.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger audit_events_immutable before update or delete on audit_events
  for each row execute function forbid_mutation();
create trigger result_revisions_immutable before update or delete on result_revisions
  for each row execute function forbid_mutation();
create trigger result_entries_immutable before update or delete on result_entries
  for each row execute function forbid_mutation();
create trigger review_events_immutable before update or delete on review_events
  for each row execute function forbid_mutation();
create trigger reference_results_immutable before update or delete on reference_results
  for each row execute function forbid_mutation();

-- Original-file fields on evidence are immutable; only status may change.
create or replace function evidence_guard() returns trigger language plpgsql as $$
begin
  if new.sha256 <> old.sha256 or new.original_path <> old.original_path
     or new.size_bytes <> old.size_bytes or new.client_submission_id <> old.client_submission_id
     or new.contributor_id <> old.contributor_id then
    raise exception 'evidence original fields are immutable';
  end if;
  return new;
end $$;
create trigger evidence_original_immutable before update on evidence
  for each row execute function evidence_guard();

-- RLS on everywhere: writes go through server route handlers with the service role.
alter table elections enable row level security;
alter table polling_units enable row level security;
alter table contributors enable row level security;
alter table evidence enable row level security;
alter table result_revisions enable row level security;
alter table result_entries enable row level security;
alter table review_events enable row level security;
alter table reference_results enable row level security;
alter table audit_events enable row level security;
create policy "public read elections" on elections for select using (true);
create policy "public read polling units" on polling_units for select using (true);
