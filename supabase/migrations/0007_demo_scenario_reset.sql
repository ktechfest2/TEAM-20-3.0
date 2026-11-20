-- Guided /demo reset (written by evidence-backend 2026-11-20; APPLY ONLY AFTER LEAD REVIEW).
-- Deletes ONLY the rows the synthetic demo actors created on one synthetic polling unit:
--   * evidence on p_unit whose contributor_id is one of p_witness_ids
--     (+ their result_revisions, result_entries, review_events and audit_events)
--   * reference_results on p_unit created_by one of p_reviewer_ids with source_type SYNTHETIC_DEMO
--     (+ their reference_reviews and REFERENCE_* audit_events)
-- Everything else (other contributors' evidence on the same unit, and demo reviewers' reviews of
-- that evidence) is untouched.
--
-- Append-only bypass design: forbid_mutation() now lets a DELETE through only when the
-- transaction-local setting polltrace.demo_reset = 'on'. Only this function sets it
-- (set_config(..., is_local => true)), and it switches it off again before returning; UPDATEs are
-- never allowed. Chosen over `ALTER TABLE ... DISABLE TRIGGER` because that is DDL: it needs table
-- ownership and takes an ACCESS EXCLUSIVE lock on every append-only table (blocking all concurrent
-- inserts such as audit events during the reset), and a bug between disable/enable would leave the
-- protection off for everyone. With the setting, triggers stay enabled for every other session.
-- Residual risk: any role that can run arbitrary SQL could set the GUC itself, but such a role can
-- already drop the trigger; API roles (anon/authenticated) have no DELETE grant/policy at all.

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('polltrace.demo_reset', true), '') = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;

create or replace function reset_demo_scenario(p_unit text, p_witness_ids uuid[], p_reviewer_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evidence_ids uuid[];
  v_revision_ids uuid[];
  v_reference_ids uuid[];
  v_paths text[];
  n_entries int := 0;
  n_revisions int := 0;
  n_reviews int := 0;
  n_audit int := 0;
  n_evidence int := 0;
  n_ref_reviews int := 0;
  n_references int := 0;
begin
  if p_unit is null or coalesce(array_length(p_witness_ids, 1), 0) = 0 then
    raise exception 'reset_demo_scenario: unit and witness ids are required';
  end if;

  -- Scope guards: synthetic unit, synthetic actors only.
  if not exists (select 1 from polling_units where id = p_unit and synthetic) then
    raise exception 'reset_demo_scenario: % is not a synthetic polling unit', p_unit;
  end if;
  if exists (select 1 from contributors where id = any(p_witness_ids) and not synthetic)
     or exists (select 1 from contributors where id = any(coalesce(p_reviewer_ids, '{}')) and not synthetic) then
    raise exception 'reset_demo_scenario: refusing non-synthetic actors';
  end if;

  select coalesce(array_agg(id), '{}'), coalesce(array_agg(original_path), '{}')
    into v_evidence_ids, v_paths
    from evidence
   where polling_unit_id = p_unit and contributor_id = any(p_witness_ids);
  if exists (select 1 from evidence where id = any(v_evidence_ids) and not synthetic) then
    raise exception 'reset_demo_scenario: refusing to delete non-synthetic evidence';
  end if;

  select coalesce(array_agg(id), '{}') into v_reference_ids
    from reference_results
   where polling_unit_id = p_unit
     and created_by = any(coalesce(p_reviewer_ids, '{}'))
     and source_type = 'SYNTHETIC_DEMO';
  if exists (select 1 from reference_results where id = any(v_reference_ids) and not synthetic) then
    raise exception 'reset_demo_scenario: refusing to delete non-synthetic references';
  end if;

  select coalesce(array_agg(id), '{}') into v_revision_ids
    from result_revisions where evidence_id = any(v_evidence_ids);

  perform set_config('polltrace.demo_reset', 'on', true);

  delete from audit_events where evidence_id = any(v_evidence_ids);
  get diagnostics n_audit = row_count;
  with d as (
    delete from audit_events
     where evidence_id is null
       and event_type in ('REFERENCE_IMPORTED', 'REFERENCE_REVIEWED')
       and (metadata->>'referenceId') = any(v_reference_ids::text[])
    returning 1)
  select n_audit + count(*) into n_audit from d;

  delete from result_entries where revision_id = any(v_revision_ids);
  get diagnostics n_entries = row_count;
  delete from result_revisions where id = any(v_revision_ids);
  get diagnostics n_revisions = row_count;
  delete from review_events where evidence_id = any(v_evidence_ids);
  get diagnostics n_reviews = row_count;
  delete from evidence where id = any(v_evidence_ids);
  get diagnostics n_evidence = row_count;

  delete from reference_reviews where reference_id = any(v_reference_ids);
  get diagnostics n_ref_reviews = row_count;
  delete from reference_results where id = any(v_reference_ids);
  get diagnostics n_references = row_count;

  perform set_config('polltrace.demo_reset', 'off', true);

  return jsonb_build_object(
    'evidence', n_evidence,
    'revisions', n_revisions,
    'entries', n_entries,
    'reviews', n_reviews,
    'audit', n_audit,
    'references', n_references,
    'referenceReviews', n_ref_reviews,
    'originalPaths', to_jsonb(v_paths)
  );
end $$;

revoke all on function reset_demo_scenario(text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function reset_demo_scenario(text, uuid[], uuid[]) to service_role;
