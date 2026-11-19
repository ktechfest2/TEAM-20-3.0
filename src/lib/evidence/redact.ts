/**
 * Redacted evidence views. `originalPath` and `contributorId` are never returned.
 * Owner sees their own alias; reviewers see only an opaque contributorRef.
 */
import type { Principal } from "@/lib/auth/session";
import type { AuditEventRecord, EvidenceRecord, StorageMode } from "@/lib/storage";

export type ViewerRelation = "OWNER" | "REVIEWER";

export interface EvidenceView {
  id: string;
  clientSubmissionId?: string; // owner only
  electionId: string;
  pollingUnitId: string;
  sourceType: EvidenceRecord["sourceType"];
  sha256: string;
  mime: string;
  sizeBytes: number;
  capturedAtClaimed: string | null;
  capturedAtIsClaimOnly: true;
  receivedAt: string;
  status: EvidenceRecord["status"];
  synthetic: boolean;
  storageMode: StorageMode;
  viewer: ViewerRelation;
  submittedByViewer: boolean;
  contributorAlias?: string; // owner only
  contributorRef?: string; // reviewer only, opaque pseudonym
  auditTrail: Array<{ eventType: string; createdAt: string; byViewer: boolean }>;
}

/** null => caller must respond 404 (don't reveal existence). */
export function relationTo(e: EvidenceRecord, p: Principal): ViewerRelation | null {
  if (e.contributorId === p.contributorId) return "OWNER";
  if (p.role === "REVIEWER") return "REVIEWER";
  return null;
}

export function toEvidenceView(
  e: EvidenceRecord,
  p: Principal,
  relation: ViewerRelation,
  audit: AuditEventRecord[],
  mode: StorageMode,
  refFor: (contributorId: string) => string,
): EvidenceView {
  const owner = relation === "OWNER";
  return {
    id: e.id,
    ...(owner ? { clientSubmissionId: e.clientSubmissionId, contributorAlias: p.alias } : {}),
    ...(!owner ? { contributorRef: refFor(e.contributorId) } : {}),
    electionId: e.electionId,
    pollingUnitId: e.pollingUnitId,
    sourceType: e.sourceType,
    sha256: e.sha256,
    mime: e.mime,
    sizeBytes: e.sizeBytes,
    capturedAtClaimed: e.capturedAtClaimed,
    capturedAtIsClaimOnly: true,
    receivedAt: e.receivedAt,
    status: e.status,
    synthetic: e.synthetic,
    storageMode: mode,
    viewer: relation,
    submittedByViewer: owner,
    auditTrail: audit.map((a) => ({
      eventType: a.eventType,
      createdAt: a.createdAt,
      byViewer: a.actorId === p.contributorId,
    })),
  };
}
