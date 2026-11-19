import { getPrincipal } from "@/lib/auth/session";
import { fromService, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { listUnitReferences } from "@/lib/references/service";
import { getStorage } from "@/lib/storage";

/** Reviewer only: every reference version for the unit, with provenance reviews. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const { id } = await ctx.params;
    const electionId = new URL(request.url).searchParams.get("electionId");
    return fromService(
      await listUnitReferences(await getPrincipal(request, storage), id, electionId, { storage, rateLimiter: workflowLimiter() }),
    );
  } catch (err) {
    return serverError(err);
  }
}
