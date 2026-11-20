/**
 * SYNTHETIC DEMO REVIEWER IDENTITIES — not real people, not real reviewers.
 * Only usable when POLLTRACE_DEMO_REVIEWERS=1. In production additionally requires
 * POLLTRACE_DEMO_REVIEWER_PASSCODE so a public deployment can't be self-promoted.
 * The role is fixed here on the server; clients can only pick WHICH synthetic reviewer.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { ContributorRecord } from "@/lib/storage";

type Env = Record<string, string | undefined>;

export const DEMO_REVIEWERS: readonly Omit<ContributorRecord, "createdAt">[] = [
  {
    id: "de000000-0000-4000-8000-00000000a001",
    alias: "Reviewer A",
    role: "REVIEWER",
    assurance: "SYNTHETIC_DEMO",
    synthetic: true,
  },
  {
    id: "de000000-0000-4000-8000-00000000b002",
    alias: "Reviewer B",
    role: "REVIEWER",
    assurance: "SYNTHETIC_DEMO",
    synthetic: true,
  },
];

export const demoReviewersEnabled = (env: Env = process.env) => env.POLLTRACE_DEMO_REVIEWERS === "1";
export const isDemoReviewerId = (id: string) => DEMO_REVIEWERS.some((r) => r.id === id);

export const INVALID_REVIEWER_PASSCODE = "Invalid sample reviewer passcode";

/** Returns null if allowed, otherwise a reason. */
export function demoReviewerLoginDenied(passcode: string | undefined, env: Env = process.env): string | null {
  if (!demoReviewersEnabled(env)) return "Sample reviewer accounts are disabled on this server";
  const expected = env.POLLTRACE_DEMO_REVIEWER_PASSCODE?.trim();
  if (!expected) {
    return env.NODE_ENV === "production" ? "POLLTRACE_DEMO_REVIEWER_PASSCODE must be set in production" : null;
  }
  // Compare fixed-length digests so neither content nor length leaks through timing.
  const a = createHash("sha256").update(passcode ?? "", "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b) ? null : INVALID_REVIEWER_PASSCODE;
}
