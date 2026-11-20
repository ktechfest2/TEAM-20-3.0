/**
 * FROZEN CONTRACT (lead-owned, 2026-11-20): guided /demo scenario.
 *
 * Every stage runs the REAL services (evidence upload + server re-hash, DEMO_FIXTURE extraction,
 * human confirmation, reviewer decisions, reference import, second-reviewer source check) as fixed
 * synthetic demo actors, on the live demo unit only. Nothing runs automatically: the presenter
 * triggers each stage with the server-side admin passcode (POLLTRACE_DEMO_ADMIN_PASSCODE, never
 * sent to the browser bundle). Reset deletes ONLY rows created by the demo actors on the demo unit;
 * evidence from anyone else (incl. the presenter's own live capture) is never modified.
 */
import { z } from "zod";
import { VerificationStatus } from "./index";

export const DEMO_UNIT_ID = "demo-pu-012";
export const DEMO_ELECTION_ID = "demo-election";

/** Order matters: each stage requires the previous ones. */
export const DemoStageId = z.enum([
  "WITNESSES", // Synthetic Demo Witness 1 & 2 upload distinct sheets, load demo figures, confirm 145/210/42
  "DUPLICATE", // Synthetic Demo Witness 3 uploads Witness 1's exact bytes (same SHA-256) and confirms
  "REVIEWS", // Reviewer A accepts all three: W1, W2 independence REVIEWER_CONFIRMED; W3 UNVERIFIED
  "REFERENCE", // Reviewer B imports SYNTHETIC_DEMO reference 145/270/42; Reviewer A confirms the source
]);
export type DemoStageId = z.infer<typeof DemoStageId>;

export const DemoStage = z.object({
  id: DemoStageId,
  done: z.boolean(),
  /** Plain-language description of what this stage did (or will do). */
  summary: z.string(),
});
export type DemoStage = z.infer<typeof DemoStage>;

/** GET /api/demo (public, no secrets) and the response of every stage/reset call. */
export const DemoState = z.object({
  /** Server has demo mode configured (demo reviewers + admin passcode set). */
  enabled: z.boolean(),
  unitId: z.literal(DEMO_UNIT_ID),
  electionId: z.literal(DEMO_ELECTION_ID),
  stages: z.array(DemoStage),
  /** Evidence ids created by the demo actors (null until created). */
  evidence: z.object({
    witness1: z.string().nullable(),
    witness2: z.string().nullable(),
    duplicate: z.string().nullable(),
  }),
  referenceId: z.string().nullable(),
  /** Current status from the real verification engine for the demo unit. */
  verificationStatus: VerificationStatus,
  synthetic: z.literal(true),
});
export type DemoState = z.infer<typeof DemoState>;

/** POST /api/demo/stages/:stage and POST /api/demo/reset body. */
export const DemoAdminRequest = z.object({ passcode: z.string().min(1).max(200) });
export type DemoAdminRequest = z.infer<typeof DemoAdminRequest>;
