/** Record -> frozen contract view mappers (src/lib/contracts/trace.ts). Server-only. */
import type { EvidenceStatus, ResultField } from "@/lib/contracts";
import type { ResultRevisionView, ReviewEventView } from "@/lib/contracts/trace";
import { PARTY_ROSTER } from "@/lib/seed/registry";
import type { ReviewEventRecord, RevisionRecord } from "@/lib/storage";

/** Stable entry order: roster order first, then anything else alphabetically. */
export function orderEntries(entries: ResultField[]): ResultField[] {
  const rank = (code: string) => {
    const i = (PARTY_ROSTER as readonly string[]).indexOf(code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...entries].sort((a, b) => rank(a.partyCode) - rank(b.partyCode) || a.partyCode.localeCompare(b.partyCode));
}

export function toRevisionView(r: RevisionRecord, viewerId: string): ResultRevisionView {
  return {
    id: r.id,
    revisionNumber: r.revisionNumber,
    origin: r.origin,
    extractionMode: r.origin === "HUMAN_CORRECTION" ? null : r.extractionMode,
    formType: r.formType,
    pollingUnitCodeOnSheet: r.pollingUnitCodeOnSheet,
    entries: orderEntries(r.entries).map((e) => ({ partyCode: e.partyCode, votes: e.votes, needsReview: e.needsReview })),
    accreditedVoters: r.accreditedVoters,
    rejectedVotes: r.rejectedVotes,
    validVotes: r.validVotes,
    warnings: [...r.warnings],
    // Filled from stored extraction metadata by the real-vision slice (evidence-backend).
    uncertainFields: [],
    provenance: null,
    humanConfirmed: r.humanConfirmed,
    basedOnRevision: r.basedOnRevision,
    note: r.note,
    createdAt: r.createdAt,
    createdByViewer: r.createdBy === viewerId,
  };
}

export function toReviewView(
  r: ReviewEventRecord,
  viewerId: string,
  synthetic: boolean,
  refFor: (reviewerId: string) => string,
): ReviewEventView {
  return {
    id: r.id,
    decision: r.decision,
    independenceStatus: r.independenceStatus,
    reason: r.reason,
    reviewerRef: refFor(r.reviewerId),
    byViewer: r.reviewerId === viewerId,
    synthetic,
    createdAt: r.createdAt,
  };
}

/** latest = highest revision number (input must be one evidence's revisions). */
export const latestRevision = (revs: RevisionRecord[]): RevisionRecord | null =>
  revs.reduce<RevisionRecord | null>((acc, r) => (!acc || r.revisionNumber > acc.revisionNumber ? r : acc), null);

/**
 * Evidence status derived from the append-only history (the source of truth); the stored
 * evidence.status column is a cache of this. Rules, applied in time order:
 *  - start RECEIVED
 *  - human-confirmed revision -> PENDING_REVIEW
 *  - machine/manual revision  -> PENDING_REVIEW if the evidence had been ACCEPTED/REJECTED
 *                                 (a reviewer must re-assess), otherwise unchanged
 *  - review ACCEPTED/REJECTED -> that status; FLAGGED -> PENDING_REVIEW
 * Ties at the same timestamp: revisions before reviews.
 */
export function deriveEvidenceStatus(
  revisions: Pick<RevisionRecord, "createdAt" | "humanConfirmed">[],
  reviews: Pick<ReviewEventRecord, "createdAt" | "decision">[],
): EvidenceStatus {
  type Ev = { at: string; order: number; apply: (s: EvidenceStatus) => EvidenceStatus };
  const events: Ev[] = [
    ...revisions.map((r) => ({
      at: r.createdAt,
      order: 0,
      apply: (s: EvidenceStatus): EvidenceStatus =>
        r.humanConfirmed || s === "ACCEPTED" || s === "REJECTED" ? "PENDING_REVIEW" : s,
    })),
    ...reviews.map((r) => ({
      at: r.createdAt,
      order: 1,
      apply: (): EvidenceStatus => (r.decision === "FLAGGED" ? "PENDING_REVIEW" : r.decision),
    })),
  ];
  events.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
  return events.reduce<EvidenceStatus>((s, e) => e.apply(s), "RECEIVED");
}
