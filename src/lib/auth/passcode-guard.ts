/**
 * Lockout for passcode-protected endpoints: wrong attempts are counted per client IP AND
 * globally (all IPs), so rotating IPs cannot brute-force a short passcode. In-memory per
 * server instance (friction, not a hard quota).
 */
export interface FailureLimiter {
  /** Seconds until allowed again, or 0. Does not count anything. */
  blockedFor(key: string, nowMs?: number): number;
  recordFailure(key: string, nowMs?: number): void;
}

export function createFailureLimiter(max: number, windowMs = 60_000): FailureLimiter {
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

export const PER_IP_FAILURES = 5;
export const GLOBAL_FAILURES = 30;
const GLOBAL_KEY = "*";

export interface PasscodeGuard {
  blockedFor(ip: string, nowMs?: number): number;
  recordFailure(ip: string, nowMs?: number): void;
}

export function createPasscodeGuard(perIp = PER_IP_FAILURES, global = GLOBAL_FAILURES, windowMs = 60_000): PasscodeGuard {
  const ipLimiter = createFailureLimiter(perIp, windowMs);
  const globalLimiter = createFailureLimiter(global, windowMs);
  return {
    blockedFor: (ip, nowMs) => Math.max(ipLimiter.blockedFor(ip, nowMs), globalLimiter.blockedFor(GLOBAL_KEY, nowMs)),
    recordFailure: (ip, nowMs) => {
      ipLimiter.recordFailure(ip, nowMs);
      globalLimiter.recordFailure(GLOBAL_KEY, nowMs);
    },
  };
}

const g = globalThis as unknown as { __polltraceDemoFailures?: PasscodeGuard; __polltraceReviewerLoginFailures?: PasscodeGuard };
/** Guard for POST /api/demo/* (admin passcode). */
export const demoAdminGuard = () => (g.__polltraceDemoFailures ??= createPasscodeGuard());
/** Guard for POST /api/session/demo-reviewer (reviewer passcode). */
export const reviewerLoginGuard = () => (g.__polltraceReviewerLoginFailures ??= createPasscodeGuard());
