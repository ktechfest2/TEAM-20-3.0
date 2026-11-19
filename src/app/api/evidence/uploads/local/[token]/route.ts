import { contentLengthOf, fromService, readBodyCapped, serverError } from "@/lib/evidence/http";
import { uploadLimiter } from "@/lib/evidence/rate-limit";
import { stageLocalUpload } from "@/lib/evidence/uploads";
import { getStorage } from "@/lib/storage";

/**
 * LOCAL_DEV stand-in for a Supabase signed upload URL: PUT raw bytes to the staging key
 * named inside the HMAC-signed grant. 404 in SUPABASE mode. Staged bytes stay untrusted
 * until finalize re-hashes them.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    const { token } = await ctx.params;
    return fromService(
      await stageLocalUpload(token, contentLengthOf(request), (max) => readBodyCapped(request, max), {
        storage: getStorage(),
        rateLimiter: uploadLimiter(),
      }),
    );
  } catch (err) {
    return serverError(err);
  }
}
