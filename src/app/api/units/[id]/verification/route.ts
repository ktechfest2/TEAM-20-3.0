import { fromService, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { getUnitVerification } from "@/lib/references/service";
import { getStorage } from "@/lib/storage";

/**
 * PUBLIC per-unit comparison (no session). Output is the deterministic engine result only:
 * no contributor ids, aliases, refs or storage paths. Never cached (Cache-Control: no-store).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const electionId = new URL(request.url).searchParams.get("electionId");
    return fromService(await getUnitVerification(id, electionId, { storage: getStorage(), rateLimiter: workflowLimiter() }));
  } catch (err) {
    return serverError(err);
  }
}
