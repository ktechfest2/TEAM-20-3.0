import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { reviewReference } from "@/lib/references/service";
import { getStorage } from "@/lib/storage";

/** Reviewer only (not the importer: 403 SELF_REVIEW). Appends a provenance review. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: workflowLimiter() };
    const { id } = await ctx.params;
    if (!principal || principal.role !== "REVIEWER") return fromService(await reviewReference(principal, id, null, deps));
    const body = await readJsonCapped(request);
    if (!body.ok) return body.response;
    return fromService(await reviewReference(principal, id, body.value, deps));
  } catch (err) {
    return serverError(err);
  }
}
