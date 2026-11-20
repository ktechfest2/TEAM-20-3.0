/**
 * Demo admin gate (server-only). The passcode lives only in POLLTRACE_DEMO_ADMIN_PASSCODE and is
 * compared in constant time (SHA-256 digests, so length doesn't leak). Failed attempts are
 * limited per client IP (in-memory, per instance: friction, not a hard quota).
 */
import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const demoEnabled = (env: Env = process.env) =>
  env.POLLTRACE_DEMO_REVIEWERS === "1" && Boolean(env.POLLTRACE_DEMO_ADMIN_PASSCODE?.trim());

export function passcodeMatches(given: string, env: Env = process.env): boolean {
  const expected = env.POLLTRACE_DEMO_ADMIN_PASSCODE?.trim();
  if (!expected) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// Lockout + client IP now live in src/lib/auth (shared with the demo-reviewer login).
export { clientIp } from "@/lib/auth/client-ip";
export { demoAdminGuard as demoFailureLimiter } from "@/lib/auth/passcode-guard";
