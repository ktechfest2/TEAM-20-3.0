import { getPrincipal } from "@/lib/auth/session";
import { json, serverError, UUID_RE } from "@/lib/evidence/http";
import { relationTo } from "@/lib/evidence/redact";
import { errorBody } from "@/lib/evidence/service";
import { getStorage } from "@/lib/storage";

/**
 * Original bytes, for the owner or a reviewer only (extraction/review screens).
 * Private storage is proxied here; no public or long-lived URL is ever issued.
 * The original still contains EXIF; do not reuse this route for public views.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    if (!principal) return json(401, errorBody("UNAUTHENTICATED", "A session is required."));

    const { id } = await ctx.params;
    const notFound = json(404, errorBody("NOT_FOUND", "Evidence not found."));
    if (!UUID_RE.test(id)) return notFound;
    const evidence = await storage.repo.getEvidence(id);
    if (!evidence || !relationTo(evidence, principal)) return notFound;

    const bytes = await storage.objects.get(evidence.originalPath);
    if (!bytes) return json(404, errorBody("ORIGINAL_MISSING", "Original bytes are not available."));

    return new Response(new Blob([bytes as BlobPart], { type: evidence.mime }), {
      status: 200,
      headers: {
        "Content-Type": evidence.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="evidence-${evidence.id}"`,
        "X-Evidence-Sha256": evidence.sha256,
        "X-Synthetic": String(evidence.synthetic),
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
