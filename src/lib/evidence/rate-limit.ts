/**
 * Fixed-window in-memory rate limiter, keyed per contributor.
 * LIMITATION: per server instance only. On serverless (Vercel) each instance has its
 * own counters and they reset on cold start, so this is abuse friction, not a quota.
 */
export interface RateLimiter {
  /** Returns 0 if allowed, else seconds until the window resets. */
  hit(key: string, nowMs?: number): number;
}

export function createFixedWindowLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, nowMs = Date.now()) {
      const w = windows.get(key);
      if (!w || nowMs - w.start >= windowMs) {
        windows.set(key, { start: nowMs, count: 1 });
        if (windows.size > 10_000) {
          for (const [k, v] of windows) if (nowMs - v.start >= windowMs) windows.delete(k);
        }
        return 0;
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - nowMs) / 1000));
      w.count += 1;
      return 0;
    },
  };
}

const g = globalThis as unknown as { __polltraceUploadLimiter?: RateLimiter };
/** 30 upload attempts per contributor per minute (idempotent retries count too). */
export function uploadLimiter(): RateLimiter {
  return (g.__polltraceUploadLimiter ??= createFixedWindowLimiter(30, 60_000));
}
