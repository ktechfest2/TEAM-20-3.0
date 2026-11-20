-- Minimal labelling (user decision 2026-11-20): fictional sample units get realistic INEC-format
-- codes with the non-existent state code 99, and plain names. Ids, synthetic flags and all
-- evidence/audit rows are unchanged. Mirrors src/lib/seed/registry.ts.
update polling_units p set code = v.code, name = v.name, state = 'Sample State', lga = v.lga, ward = v.ward
from (values
  ('demo-pu-012', '99-04-07-012', 'Community Hall', 'Central LGA', 'Market Ward'),
  ('demo-pu-001', '99-04-07-001', 'Primary School I', 'Central LGA', 'Market Ward'),
  ('demo-pu-002', '99-04-07-002', 'Primary School II', 'Central LGA', 'Market Ward'),
  ('demo-pu-007', '99-04-07-007', 'Market Square', 'Central LGA', 'Market Ward'),
  ('demo-pu-101', '99-04-08-101', 'Health Centre', 'Central LGA', 'Hill Ward'),
  ('demo-pu-102', '99-04-08-102', 'Town Library', 'Central LGA', 'Hill Ward'),
  ('demo-pu-201', '99-05-02-201', 'Civic Centre', 'North LGA', 'River Ward')
) as v(id, code, name, lga, ward)
where p.id = v.id and p.synthetic;

update elections set name = 'Sample Presidential Election (fictional)' where id = 'demo-election' and synthetic;
