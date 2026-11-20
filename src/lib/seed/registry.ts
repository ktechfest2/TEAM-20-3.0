/**
 * SYNTHETIC DEMO REGISTRY — FICTIONAL TEST DATA, NOT OFFICIAL ELECTION RESULTS.
 * Mirrors fixtures/demo_cases.json (demo-election, demo-pu-012) plus a few extra
 * synthetic units so the polling-unit finder has something to search.
 * No real party, polling unit, ward or witness is represented here.
 */
import type { Election, PollingUnit } from "@/lib/contracts";
import { NG2023_ELECTION_ID, NG2023_PARTY_ROSTER, NG2023_SOURCE, NG2023_UNITS } from "./historical-ng2023";

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
  {
    id: NG2023_ELECTION_ID,
    name: "2023 Presidential Election (historical sample — Nigeria 2.0 crosscheck, not INEC-certified)",
    type: "PRESIDENTIAL",
    date: "2023-02-25",
    synthetic: false,
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

/** Synthetic demo units: the only units new evidence can be captured for in this build. */
export const SYNTHETIC_UNITS: readonly PollingUnit[] = units.map(([id, code, name, lga, ward]) => ({
  id,
  registrySource: REGISTRY_SOURCE,
  code,
  name,
  state: "Demo State",
  lga,
  ward,
  synthetic: true,
}));

/** Real 2023 units (historical sample, see historical-ng2023.ts). Reference records only. */
export const HISTORICAL_UNITS: readonly PollingUnit[] = NG2023_UNITS.map((u) => ({
  id: u.id,
  registrySource: NG2023_SOURCE.id,
  code: u.code,
  name: u.name,
  state: u.state,
  lga: u.lga,
  ward: u.ward,
  synthetic: false,
}));

export const POLLING_UNITS: readonly PollingUnit[] = [...SYNTHETIC_UNITS, ...HISTORICAL_UNITS];

/** The election new captures are filed under (synthetic demo election). */
export const CAPTURE_ELECTION_ID = "demo-election";

/** Election a polling unit belongs to in this build's registry. */
export function electionForUnit(unitId: string): string {
  return unitId.startsWith("ng23-") ? NG2023_ELECTION_ID : CAPTURE_ELECTION_ID;
}

/** Party roster per election (party codes as they appear on that election's result sheets). */
export function partyRosterFor(electionId: string): readonly string[] {
  return electionId === NG2023_ELECTION_ID ? NG2023_PARTY_ROSTER : PARTY_ROSTER;
}

/** Units a capturer may pick: synthetic demo units only (no new evidence on historical units). */
export function searchCaptureUnits(query: string, limit = 20): PollingUnit[] {
  return searchPollingUnits(query, 50)
    .filter((u) => u.synthetic)
    .slice(0, Math.max(1, Math.min(limit, 50)));
}

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
