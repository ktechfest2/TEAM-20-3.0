-- SYNTHETIC DEMO REGISTRY — FICTIONAL TEST DATA, NOT OFFICIAL ELECTION RESULTS.
-- Mirrors src/lib/seed/registry.ts. Keep both in sync.

insert into elections (id, name, type, date, synthetic) values
  ('demo-election', 'Synthetic Civic Demo Election', 'PRESIDENTIAL', '2026-11-19', true)
on conflict (id) do nothing;

insert into polling_units (id, registry_source, code, state, lga, ward, name, synthetic) values
  ('demo-pu-012', 'SYNTHETIC_DEMO', 'DEMO.00.00.012', 'Demo State', 'Demo LGA', 'Demo Ward', 'Synthetic Community Hall', true),
  ('demo-pu-001', 'SYNTHETIC_DEMO', 'DEMO.00.00.001', 'Demo State', 'Demo LGA', 'Demo Ward', 'Synthetic Primary School I', true),
  ('demo-pu-002', 'SYNTHETIC_DEMO', 'DEMO.00.00.002', 'Demo State', 'Demo LGA', 'Demo Ward', 'Synthetic Primary School II', true),
  ('demo-pu-007', 'SYNTHETIC_DEMO', 'DEMO.00.00.007', 'Demo State', 'Demo LGA', 'Demo Ward', 'Synthetic Market Square', true),
  ('demo-pu-101', 'SYNTHETIC_DEMO', 'DEMO.00.01.101', 'Demo State', 'Demo LGA', 'Demo North Ward', 'Synthetic Health Centre', true),
  ('demo-pu-102', 'SYNTHETIC_DEMO', 'DEMO.00.01.102', 'Demo State', 'Demo LGA', 'Demo North Ward', 'Synthetic Town Library', true),
  ('demo-pu-201', 'SYNTHETIC_DEMO', 'DEMO.01.02.201', 'Demo State', 'Demo East LGA', 'Demo Riverside Ward', 'Synthetic Civic Centre', true)
on conflict (id) do nothing;
