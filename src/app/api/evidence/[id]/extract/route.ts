import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { extractLimiter } from "@/lib/evidence/rate-limit";
import { extractEvidence } from "@/lib/evidence/workflow";
import { getStorage } from "@/lib/storage";

/** Owner or reviewer. Runs extraction on the private original; appends a non-confirmed revision. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: extractLimiter() };
    const { id } = await ctx.params;
    if (!principal) return fromService(await extractEvidence(null, id, null, deps));
    let body: unknown = {};
    if (request.headers.get("content-length") !== "0" && request.body) {
      const parsed = await readJsonCapped(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }
    return fromService(await extractEvidence(principal, id, body, deps));
  } catch (err) {
    return serverError(err);
  }
}
