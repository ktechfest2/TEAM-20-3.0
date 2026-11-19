-- Atomic insert of a result revision together with its entries (lead-approved 2026-11-19).
-- Without this, a failure between the two inserts would leave a permanent (append-only)
-- revision with no figures. Callable only with the server's secret key.
create or replace function insert_result_revision(rev jsonb, entries jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into result_revisions (id, evidence_id, revision_number, origin, extraction_mode, form_type,
    polling_unit_code_on_sheet, accredited_voters, rejected_votes, valid_votes, warnings, raw_extraction,
    human_confirmed, based_on_revision, note, created_by, created_at)
  values ((rev->>'id')::uuid, (rev->>'evidence_id')::uuid, (rev->>'revision_number')::int, rev->>'origin',
    rev->>'extraction_mode', rev->>'form_type', rev->>'polling_unit_code_on_sheet',
    (rev->>'accredited_voters')::int, (rev->>'rejected_votes')::int, (rev->>'valid_votes')::int,
    coalesce(rev->'warnings', '[]'::jsonb), rev->'raw_extraction', (rev->>'human_confirmed')::boolean,
    (rev->>'based_on_revision')::int, rev->>'note', (rev->>'created_by')::uuid, (rev->>'created_at')::timestamptz);
  insert into result_entries (revision_id, party_code, votes, needs_review)
  select (rev->>'id')::uuid, e->>'party_code', (e->>'votes')::int, (e->>'needs_review')::boolean
  from jsonb_array_elements(entries) e;
end $$;

revoke all on function insert_result_revision(jsonb, jsonb) from public, anon, authenticated;
grant execute on function insert_result_revision(jsonb, jsonb) to service_role;
