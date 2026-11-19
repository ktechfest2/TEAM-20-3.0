import { contributorRef, getPrincipal } from "@/lib/auth/session";
import { json, serverError, UUID_RE } from "@/lib/evidence/http";
import { relationTo, toEvidenceView } from "@/lib/evidence/redact";
import { errorBody } from "@/lib/evidence/service";
import { getStorage } from "@/lib/storage";

/** Owner or reviewer only. Anyone else gets 404 so ids can't be probed. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    if (!principal) return json(401, errorBody("UNAUTHENTICATED", "A session is required."));

    const { id } = await ctx.params;
    const notFound = json(404, errorBody("NOT_FOUND", "Evidence not found."));
    if (!UUID_RE.test(id)) return notFound;

    const evidence = await storage.repo.getEvidence(id);
    if (!evidence) return notFound;
    const relation = relationTo(evidence, principal);
    if (!relation) return notFound;

    const audit = await storage.repo.listAudit(id);
    return json(200, toEvidenceView(evidence, principal, relation, audit, storage.mode, contributorRef));
  } catch (err) {
    return serverError(err);
  }
}
