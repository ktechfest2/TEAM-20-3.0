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

const gw = globalThis as unknown as { __polltraceWorkflowLimiter?: RateLimiter; __polltraceExtractLimiter?: RateLimiter };
/** Review / confirm writes: 60 per principal per minute (per instance). */
export function workflowLimiter(): RateLimiter {
  return (gw.__polltraceWorkflowLimiter ??= createFixedWindowLimiter(60, 60_000));
}
/** Extraction (may call a paid vision API later): 10 per principal per minute (per instance). */
export function extractLimiter(): RateLimiter {
  return (gw.__polltraceExtractLimiter ??= createFixedWindowLimiter(10, 60_000));
}

const gi = globalThis as unknown as { __polltraceIpLimiters?: Map<string, RateLimiter> };
/**
 * Per-client-IP request limiter, one bucket set per name (per instance).
 * verification: 60/min public reads; session: 10/min NEW anonymous sessions.
 */
export function ipLimiter(name: "verification" | "session"): RateLimiter {
  const map = (gi.__polltraceIpLimiters ??= new Map());
  let l = map.get(name);
  if (!l) {
    l = createFixedWindowLimiter(name === "verification" ? 60 : 10, 60_000);
    map.set(name, l);
  }
  return l;
}

/** Tests only: clear per-IP buckets (route tests create many sessions from one "IP"). */
export function resetIpLimitersForTests(): void {
  gi.__polltraceIpLimiters = undefined;
}
