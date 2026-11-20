import { clientIp } from "@/lib/auth/client-ip";
import { fromService, json, serverError } from "@/lib/evidence/http";
import { ipLimiter, workflowLimiter } from "@/lib/evidence/rate-limit";
import { errorBody } from "@/lib/evidence/service";
import { getUnitVerification } from "@/lib/references/service";
import { getStorage } from "@/lib/storage";

/**
 * PUBLIC per-unit comparison (no session). Output is the deterministic engine result only:
 * no contributor ids, aliases, refs or storage paths. Per-IP limit 60/min (429).
 * Kept no-store (not CDN-cached) so the public view never lags a reviewer decision mid-demo.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const wait = ipLimiter("verification").hit(`ip:${clientIp(request)}`);
    if (wait > 0) return json(429, errorBody("RATE_LIMITED", "Too many requests; retry later."), { "Retry-After": String(wait) });
    const { id } = await ctx.params;
    const electionId = new URL(request.url).searchParams.get("electionId");
    return fromService(await getUnitVerification(id, electionId, { storage: getStorage(), rateLimiter: workflowLimiter() }));
  } catch (err) {
    return serverError(err);
  }
}
