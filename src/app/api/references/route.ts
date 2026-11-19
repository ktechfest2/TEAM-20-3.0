import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { importReference } from "@/lib/references/service";
import { getStorage } from "@/lib/storage";

/** Reviewer only. Creates an immutable new reference version. sourceUrl is recorded, never fetched. */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: workflowLimiter() };
    if (!principal || principal.role !== "REVIEWER") return fromService(await importReference(principal, null, deps));
    const body = await readJsonCapped(request);
    if (!body.ok) return body.response;
    return fromService(await importReference(principal, body.value, deps));
  } catch (err) {
    return serverError(err);
  }
}
