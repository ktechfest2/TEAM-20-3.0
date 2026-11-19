import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { reviewEvidence } from "@/lib/evidence/workflow";
import { getStorage } from "@/lib/storage";

/** Reviewer only; 403 SELF_REVIEW for own evidence. Appends a review event; latest decision sets status. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: workflowLimiter() };
    const { id } = await ctx.params;
    if (!principal) return fromService(await reviewEvidence(null, id, null, deps));
    let body: unknown = null;
    if (request.headers.get("content-length") !== "0" && request.body) {
      const parsed = await readJsonCapped(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }
    return fromService(await reviewEvidence(principal, id, body, deps));
  } catch (err) {
    return serverError(err);
  }
}
