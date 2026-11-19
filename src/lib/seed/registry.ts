/**
 * SYNTHETIC DEMO REGISTRY — FICTIONAL TEST DATA, NOT OFFICIAL ELECTION RESULTS.
 * Mirrors fixtures/demo_cases.json (demo-election, demo-pu-012) plus a few extra
 * synthetic units so the polling-unit finder has something to search.
 * No real party, polling unit, ward or witness is represented here.
 */
import type { Election, PollingUnit } from "@/lib/contracts";

export const SYNTHETIC_DISCLAIMER = "FICTIONAL TEST DATA — NOT OFFICIAL ELECTION RESULTS";
export const REGISTRY_SOURCE = "SYNTHETIC_DEMO";

export const ELECTIONS: readonly Election[] = [
  {
    id: "demo-election",
    name: "Synthetic Civic Demo Election",
    type: "PRESIDENTIAL",
    date: "2026-11-19",
    synthetic: true,
  },
];

export const PARTY_ROSTER = ["PARTY_A", "PARTY_B", "PARTY_C"] as const;

const units: Array<[id: string, code: string, name: string, lga: string, ward: string]> = [
  ["demo-pu-012", "DEMO.00.00.012", "Synthetic Community Hall", "Demo LGA", "Demo Ward"],
  ["demo-pu-001", "DEMO.00.00.001", "Synthetic Primary School I", "Demo LGA", "Demo Ward"],
  ["demo-pu-002", "DEMO.00.00.002", "Synthetic Primary School II", "Demo LGA", "Demo Ward"],
  ["demo-pu-007", "DEMO.00.00.007", "Synthetic Market Square", "Demo LGA", "Demo Ward"],
  ["demo-pu-101", "DEMO.00.01.101", "Synthetic Health Centre", "Demo LGA", "Demo North Ward"],
  ["demo-pu-102", "DEMO.00.01.102", "Synthetic Town Library", "Demo LGA", "Demo North Ward"],
  ["demo-pu-201", "DEMO.01.02.201", "Synthetic Civic Centre", "Demo East LGA", "Demo Riverside Ward"],
];

export const POLLING_UNITS: readonly PollingUnit[] = units.map(([id, code, name, lga, ward]) => ({
  id,
  registrySource: REGISTRY_SOURCE,
  code,
  name,
  state: "Demo State",
  lga,
  ward,
  synthetic: true,
}));

/** Case- and punctuation-insensitive search over code, name and location hierarchy. */
export function searchPollingUnits(query: string, limit = 20): PollingUnit[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = norm(query.trim());
  const matches = q
    ? POLLING_UNITS.filter((u) =>
        [u.code, u.name, u.state, u.lga, u.ward].some((f) => norm(f).includes(q)),
      )
    : [...POLLING_UNITS];
  return matches.slice(0, Math.max(1, Math.min(limit, 50)));
}

export function findPollingUnit(id: string): PollingUnit | undefined {
  return POLLING_UNITS.find((u) => u.id === id);
}

export function findElection(id: string): Election | undefined {
  return ELECTIONS.find((e) => e.id === id);
}
