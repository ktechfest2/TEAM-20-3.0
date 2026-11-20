/**
 * SYNTHETIC DEMO ACTORS — fictional identities for the guided /demo only. Not real people.
 * Fixed ids so stages are idempotent and reset can be scoped exactly to their rows.
 */
import type { ContributorRecord } from "@/lib/storage";
import { DEMO_REVIEWERS } from "@/lib/auth/demo-reviewers";

type Actor = Omit<ContributorRecord, "createdAt">;
const witness = (n: 1 | 2 | 3): Actor => ({
  id: `de000000-0000-4000-8000-0000000c000${n}`,
  alias: `Synthetic Demo Witness ${n}`,
  role: "CONTRIBUTOR",
  assurance: "SYNTHETIC_DEMO",
  synthetic: true,
});

export const DEMO_WITNESS_1 = witness(1);
export const DEMO_WITNESS_2 = witness(2);
export const DEMO_WITNESS_3 = witness(3);
export const DEMO_WITNESSES = [DEMO_WITNESS_1, DEMO_WITNESS_2, DEMO_WITNESS_3] as const;
export const DEMO_REVIEWER_A = DEMO_REVIEWERS[0];
export const DEMO_REVIEWER_B = DEMO_REVIEWERS[1];

/** Fixed clientSubmissionIds: re-running an upload stage replays the same receipt. */
export const DEMO_SUBMISSION_IDS = {
  witness1: "de000000-0000-4000-8000-0000000d0001",
  witness2: "de000000-0000-4000-8000-0000000d0002",
  duplicate: "de000000-0000-4000-8000-0000000d0003",
} as const;

export const DEMO_REFERENCE_DESCRIPTION = "Synthetic demo reference record (fictional) for the guided demo";
export const DEMO_REFERENCE_FIGURES = { PARTY_A: 145, PARTY_B: 270, PARTY_C: 42 } as const;
export const DEMO_WITNESS_FIGURES = { PARTY_A: 145, PARTY_B: 210, PARTY_C: 42 } as const;
