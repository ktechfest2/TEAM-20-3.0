import { getPrincipal } from "@/lib/auth/session";
import { fromService, serverError } from "@/lib/evidence/http";
import { workflowLimiter } from "@/lib/evidence/rate-limit";
import { getReviewQueue } from "@/lib/evidence/workflow";
import { getStorage } from "@/lib/storage";

/** Reviewer only: evidence awaiting a decision (RECEIVED / PENDING_REVIEW incl. FLAGGED), oldest first. */
export async function GET(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    return fromService(await getReviewQueue(await getPrincipal(request, storage), { storage, rateLimiter: workflowLimiter() }));
  } catch (err) {
    return serverError(err);
  }
}
