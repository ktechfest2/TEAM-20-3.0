/** Shared "who may touch this evidence" resolution for /api/evidence/:id/* routes. */
import type { Principal } from "@/lib/auth/session";
import type { EvidenceRecord, EvidenceStorage } from "@/lib/storage";
import { UUID_RE } from "./http";
import { relationTo, type ViewerRelation } from "./redact";
import { fail, type ServiceResult } from "./service";

export const unauthenticated = () => fail(401, "UNAUTHENTICATED", "A session is required.");
export const evidenceNotFound = () => fail(404, "NOT_FOUND", "Evidence not found.");
export const reviewersOnly = () => fail(403, "REVIEWER_ONLY", "Only reviewers can record a decision.");

/**
 * Loads evidence the principal may see (owner or reviewer). Everyone else gets 404, never
 * 403, so evidence ids cannot be probed.
 */
export async function loadVisibleEvidence(
  p: Principal | null,
  id: string,
  storage: EvidenceStorage,
): Promise<{ ok: true; evidence: EvidenceRecord; relation: ViewerRelation; principal: Principal } | { ok: false; result: ServiceResult }> {
  if (!p) return { ok: false, result: unauthenticated() };
  if (!UUID_RE.test(id)) return { ok: false, result: evidenceNotFound() };
  const evidence = await storage.repo.getEvidence(id);
  if (!evidence) return { ok: false, result: evidenceNotFound() };
  const relation = relationTo(evidence, p);
  if (!relation) return { ok: false, result: evidenceNotFound() };
  return { ok: true, evidence, relation, principal: p };
}
