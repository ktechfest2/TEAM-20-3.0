import { getPrincipal } from "@/lib/auth/session";
import { fromService, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { getTrace } from "@/lib/evidence/workflow";
import { getStorage } from "@/lib/storage";

/** ProofTrail for one evidence file. Owner or reviewer; everyone else 404. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const { id } = await ctx.params;
    return fromService(await getTrace(await getPrincipal(request, storage), id, { storage, rateLimiter: workflowLimiter() }));
  } catch (err) {
    return serverError(err);
  }
}
