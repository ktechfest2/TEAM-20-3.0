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

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 60_000;

export interface FailureLimiter {
  /** Seconds until allowed again, or 0. Does not count anything. */
  blockedFor(key: string, nowMs?: number): number;
  recordFailure(key: string, nowMs?: number): void;
}

export function createFailureLimiter(max = MAX_FAILURES, windowMs = FAILURE_WINDOW_MS): FailureLimiter {
  const m = new Map<string, { start: number; count: number }>();
  return {
    blockedFor(key, nowMs = Date.now()) {
      const w = m.get(key);
      if (!w || nowMs - w.start >= windowMs) return 0;
      return w.count >= max ? Math.max(1, Math.ceil((w.start + windowMs - nowMs) / 1000)) : 0;
    },
    recordFailure(key, nowMs = Date.now()) {
      const w = m.get(key);
      if (!w || nowMs - w.start >= windowMs) m.set(key, { start: nowMs, count: 1 });
      else w.count += 1;
    },
  };
}

const g = globalThis as unknown as { __polltraceDemoFailures?: FailureLimiter };
export const demoFailureLimiter = () => (g.__polltraceDemoFailures ??= createFailureLimiter());

/** Best-effort client IP (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
