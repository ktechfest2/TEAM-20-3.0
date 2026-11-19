/**
 * SYNTHETIC DEMO REVIEWER IDENTITIES — not real people, not real reviewers.
 * Only usable when POLLTRACE_DEMO_REVIEWERS=1. In production additionally requires
 * POLLTRACE_DEMO_REVIEWER_PASSCODE so a public deployment can't be self-promoted.
 * The role is fixed here on the server; clients can only pick WHICH synthetic reviewer.
 */
import { timingSafeEqual } from "node:crypto";
import type { ContributorRecord } from "@/lib/storage";

type Env = Record<string, string | undefined>;

export const DEMO_REVIEWERS: readonly Omit<ContributorRecord, "createdAt">[] = [
  {
    id: "de000000-0000-4000-8000-00000000a001",
    alias: "Synthetic Demo Reviewer A",
    role: "REVIEWER",
    assurance: "SYNTHETIC_DEMO",
    synthetic: true,
  },
  {
    id: "de000000-0000-4000-8000-00000000b002",
    alias: "Synthetic Demo Reviewer B",
    role: "REVIEWER",
    assurance: "SYNTHETIC_DEMO",
    synthetic: true,
  },
];

export const demoReviewersEnabled = (env: Env = process.env) => env.POLLTRACE_DEMO_REVIEWERS === "1";
export const isDemoReviewerId = (id: string) => DEMO_REVIEWERS.some((r) => r.id === id);

/** Returns null if allowed, otherwise a reason. */
export function demoReviewerLoginDenied(passcode: string | undefined, env: Env = process.env): string | null {
  if (!demoReviewersEnabled(env)) return "Demo reviewer identities are disabled";
  const expected = env.POLLTRACE_DEMO_REVIEWER_PASSCODE?.trim();
  if (!expected) {
    return env.NODE_ENV === "production" ? "POLLTRACE_DEMO_REVIEWER_PASSCODE must be set in production" : null;
  }
  const a = Buffer.from(passcode ?? "", "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b) ? null : "Invalid demo reviewer passcode";
}
