import { getPrincipal } from "@/lib/auth/session";
import { fromService, readJsonCapped, serverError } from "@/lib/evidence/http";
import { uploadLimiter } from "@/lib/evidence/rate-limit";
import { finalizeUpload } from "@/lib/evidence/uploads";
import { getStorage } from "@/lib/storage";

/** Step 3: download staged bytes server-side, verify, promote to the immutable original. */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: uploadLimiter() };
    if (!principal) return fromService(await finalizeUpload(null, null, deps));
    const body = await readJsonCapped(request);
    if (!body.ok) return body.response;
    return fromService(await finalizeUpload(principal, body.value, deps));
  } catch (err) {
    return serverError(err);
  }
}
