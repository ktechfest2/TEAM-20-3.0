import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { uploadLimiter } from "@/lib/evidence/rate-limit";
import { initUpload } from "@/lib/evidence/uploads";
import { getStorage } from "@/lib/storage";

/** Step 1 of the direct upload: validate + idempotency, then issue a signed staging target. */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: uploadLimiter() };
    if (!principal) return fromService(await initUpload(null, null, deps));
    const body = await readJsonCapped(request);
    if (!body.ok) return body.response;
    return fromService(await initUpload(principal, body.value, deps));
  } catch (err) {
    return serverError(err);
  }
}
