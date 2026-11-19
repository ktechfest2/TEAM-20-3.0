-- ADMIN ONLY — one-time reset of a SYNTHETIC-ONLY demo database (user-approved 2026-11-20).
-- Wipes evidence, revisions, reviews, references and their audit trail so the live demo starts
-- clean. Append-only triggers are suspended ONLY inside this transaction. Refuses to run if any
-- non-synthetic election, evidence or reference exists. Registry (elections, polling_units) kept.
-- Storage objects are removed separately by supabase/admin/reset-storage.mjs.
-- Run: psql "<pooler conn>" -v ON_ERROR_STOP=1 -f supabase/admin/reset_synthetic_demo.sql
begin;

do $$
begin
  if exists (select 1 from elections where synthetic = false)
     or exists (select 1 from evidence where synthetic = false)
     or exists (select 1 from reference_results where synthetic = false) then
    raise exception 'Refusing to reset: non-synthetic data present';
  end if;
end $$;

create temp table reset_counts on commit drop as
select
  (select count(*) from evidence) as evidence,
  (select count(*) from result_revisions) as result_revisions,
  (select count(*) from review_events) as review_events,
  (select count(*) from reference_results) as reference_results,
  (select count(*) from reference_reviews) as reference_reviews,
  (select count(*) from audit_events) as audit_events,
  (select count(*) from contributors) as contributors;

alter table reference_reviews disable trigger user;
alter table reference_results disable trigger user;
alter table review_events disable trigger user;
alter table result_entries disable trigger user;
alter table result_revisions disable trigger user;
alter table audit_events disable trigger user;
alter table evidence disable trigger user;

delete from reference_reviews;
delete from reference_results;
delete from review_events;
delete from result_entries;
delete from result_revisions;
delete from audit_events;
delete from evidence;
delete from contributors;

alter table reference_reviews enable trigger user;
alter table reference_results enable trigger user;
alter table review_events enable trigger user;
alter table result_entries enable trigger user;
alter table result_revisions enable trigger user;
alter table audit_events enable trigger user;
alter table evidence enable trigger user;

-- Leave an honest record that a reset happened and what it removed.
insert into audit_events (evidence_id, actor_id, event_type, metadata)
select null, null, 'DEMO_DATA_RESET',
  to_jsonb(r) || jsonb_build_object(
    'reason', 'One-time admin reset of synthetic test data before demo rehearsal (user-approved).',
    'synthetic', true)
from reset_counts r;

select * from reset_counts;
commit;
