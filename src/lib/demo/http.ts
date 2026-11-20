import "server-only";
import { DemoAdminRequest } from "@/lib/contracts/demo";
import { json, readJsonCapped } from "@/lib/evidence/http";
import { errorBody } from "@/lib/evidence/service";
import { clientIp, demoEnabled, demoFailureLimiter, passcodeMatches } from "./admin";

/**
 * Gate for POST /api/demo/*: 403 DEMO_DISABLED -> 429 (too many failed passcodes from this IP)
 * -> 400 body -> 401 DEMO_PASSCODE_INVALID. Only wrong passcodes count as failures.
 */
export async function demoAdminGate(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!demoEnabled()) {
    return { ok: false, response: json(403, errorBody("DEMO_DISABLED", "Demo mode is not configured on this server.")) };
  }
  const limiter = demoFailureLimiter();
  const ip = clientIp(request);
  const wait = limiter.blockedFor(ip);
  if (wait > 0) {
    return {
      ok: false,
      response: json(429, errorBody("RATE_LIMITED", "Too many wrong passcodes. Try again shortly."), { "Retry-After": String(wait) }),
    };
  }
  const body = await readJsonCapped(request);
  if (!body.ok) return { ok: false, response: body.response };
  const parsed = DemoAdminRequest.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: json(400, errorBody("INVALID_REQUEST", "Expected { passcode }.")) };
  if (!passcodeMatches(parsed.data.passcode)) {
    limiter.recordFailure(ip);
    return { ok: false, response: json(401, errorBody("DEMO_PASSCODE_INVALID", "Wrong demo passcode.")) };
  }
  return { ok: true };
}
