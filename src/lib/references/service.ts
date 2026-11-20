/**
 * Reference results (immutable, versioned) + provenance reviews + the public per-unit
 * verification read (server-only).
 *  - sourceUrl is stored as text and NEVER fetched by the server (no SSRF surface).
 *  - sourceVerified is DERIVED: latest reference review is SOURCE_CONFIRMED. It means a reviewer
 *    other than the importer looked at the source's provenance. It is not certification by anyone.
 *  - The comparison itself is the pure engine in @/lib/verification; this module only assembles input.
 */
import { randomUUID } from "node:crypto";
import { ReferenceRequest } from "@/lib/contracts";
import { ReferenceReviewRequest, type ReferenceView, type UnitVerification, type VerificationEvidenceInput, type VerificationReferenceInput } from "@/lib/contracts/verification";
import { reviewerRef, unitVerificationRef, type Principal } from "@/lib/auth/session";
import { computeVerification } from "@/lib/verification";
import { findElection, findPollingUnit, PARTY_ROSTER } from "@/lib/seed/registry";
import type { EvidenceRecord, ReferenceRecord, ReferenceReviewRecord, ReviewEventRecord, RevisionRecord } from "@/lib/storage";
import { reviewersOnly, unauthenticated } from "@/lib/evidence/access";
import { UUID_RE } from "@/lib/evidence/http";
import { fail, invalid, rateLimited, type ServiceResult } from "@/lib/evidence/service";
import { latestRevision } from "@/lib/evidence/views";
import type { WorkflowDeps } from "@/lib/evidence/workflow";

export const AUDIT_REFERENCE_IMPORTED = "REFERENCE_IMPORTED";
export const AUDIT_REFERENCE_REVIEWED = "REFERENCE_REVIEWED";
const MAX_VERSION_RETRIES = 5;
const MAX_URL_LENGTH = 2048;

const nowIso = (d: WorkflowDeps) => (d.now ?? (() => new Date()))().toISOString();
const newIdOf = (d: WorkflowDeps) => (d.newId ?? randomUUID)();

export type ReferenceReviewState = "NOT_REVIEWED" | "CONFIRMED" | "REJECTED";

/** From the latest provenance review (append-only log, latest wins). */
export function reviewStateFrom(reviews: Pick<ReferenceReviewRecord, "decision">[]): ReferenceReviewState {
  const last = reviews.at(-1)?.decision;
  return last === "SOURCE_CONFIRMED" ? "CONFIRMED" : last === "SOURCE_REJECTED" ? "REJECTED" : "NOT_REVIEWED";
}
/** sourceVerified is exactly reviewState === "CONFIRMED". */
export const sourceVerifiedFrom = (reviews: Pick<ReferenceReviewRecord, "decision">[]) =>
  reviewStateFrom(reviews) === "CONFIRMED";

function toReferenceView(r: ReferenceRecord, reviews: ReferenceReviewRecord[], viewerId: string): ReferenceView {
  const own = reviews.filter((x) => x.referenceId === r.id);
  return {
    id: r.id,
    version: r.version,
    sourceType: r.sourceType,
    sourceDescription: r.sourceDescription,
    sourceUrl: r.sourceUrl,
    sourceVerified: sourceVerifiedFrom(own),
    reviewState: reviewStateFrom(own),
    synthetic: r.synthetic,
    figures: { ...r.figures },
    electionId: r.electionId,
    pollingUnitId: r.pollingUnitId,
    importedByViewer: r.createdBy === viewerId,
    createdAt: r.createdAt,
    reviews: own.map((x) => ({
      decision: x.decision,
      reason: x.reason,
      reviewerRef: reviewerRef(x.reviewerId),
      byViewer: x.reviewerId === viewerId,
      createdAt: x.createdAt,
    })),
  };
}

/** Only plain web links are recorded; the server never requests them. */
function sourceUrlProblem(url: string | undefined): string | null {
  if (url === undefined) return null;
  if (url.length > MAX_URL_LENGTH) return "sourceUrl is too long.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "sourceUrl is not a valid URL.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "sourceUrl must be an http(s) link.";
  if (parsed.username || parsed.password) return "sourceUrl must not contain credentials.";
  return null;
}

/* ------------------------------------------------------------------ import */

export async function importReference(p: Principal | null, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  if (!p) return unauthenticated();
  if (p.role !== "REVIEWER") return reviewersOnly();
  const limited = rateLimited(deps.rateLimiter, `reference:${p.contributorId}`);
  if (limited) return limited;

  const parsed = ReferenceRequest.safeParse(body);
  if (!parsed.success) return invalid("INVALID_REQUEST", "Reference failed validation.", parsed.error);
  const req = parsed.data;

  const election = findElection(req.electionId);
  if (!election) return fail(400, "UNKNOWN_ELECTION", "Unknown electionId.");
  const unit = findPollingUnit(req.pollingUnitId);
  if (!unit) return fail(400, "UNKNOWN_POLLING_UNIT", "Unknown pollingUnitId.");

  const urlProblem = sourceUrlProblem(req.sourceUrl);
  if (urlProblem) return fail(400, "INVALID_SOURCE_URL", urlProblem);

  const roster = PARTY_ROSTER as readonly string[];
  const parties = Object.keys(req.figures);
  const unknown = parties.filter((k) => !roster.includes(k));
  if (parties.length === 0) return fail(400, "INVALID_FIGURES", "A reference needs at least one party figure.");
  if (unknown.length) {
    return fail(400, "INVALID_FIGURES", "Some party codes are not on this election's party list.", {
      issues: unknown.map((k) => `${k} is not on this election's party list.`),
    });
  }

  if ((election.synthetic || unit.synthetic) && !req.synthetic) {
    return fail(400, "SYNTHETIC_REQUIRED", "This election or polling unit is synthetic demo data, so the reference must be marked synthetic.");
  }
  if (req.sourceType === "SYNTHETIC_DEMO" && !req.synthetic) {
    return fail(400, "SYNTHETIC_REQUIRED", "A SYNTHETIC_DEMO reference must be marked synthetic.");
  }

  const createdAt = nowIso(deps);
  let stored: ReferenceRecord | null = null;
  for (let attempt = 0; attempt < MAX_VERSION_RETRIES && !stored; attempt++) {
    const existing = await deps.storage.repo.listReferences(election.id, unit.id);
    const record: ReferenceRecord = {
      id: newIdOf(deps),
      electionId: election.id,
      pollingUnitId: unit.id,
      sourceType: req.sourceType,
      sourceDescription: req.sourceDescription.trim(),
      sourceUrl: req.sourceUrl ?? null,
      version: (existing.at(-1)?.version ?? 0) + 1,
      figures: { ...req.figures },
      synthetic: req.synthetic,
      createdBy: p.contributorId,
      createdAt,
    };
    if ((await deps.storage.repo.insertReference(record)).inserted) stored = record;
  }
  if (!stored) return fail(409, "REFERENCE_VERSION_CONFLICT", "Another reference was being saved at the same time. Try again.");

  await deps.storage.repo.appendAudit({
    id: newIdOf(deps),
    evidenceId: null,
    actorId: p.contributorId,
    eventType: AUDIT_REFERENCE_IMPORTED,
    metadata: {
      referenceId: stored.id,
      electionId: stored.electionId,
      pollingUnitId: stored.pollingUnitId,
      version: stored.version,
      sourceType: stored.sourceType,
      sourceUrlRecorded: stored.sourceUrl !== null,
      synthetic: stored.synthetic,
    },
    createdAt,
  });
  return { status: 201, body: toReferenceView(stored, [], p.contributorId) };
}

/* ------------------------------------------------------------------ provenance review */

export async function reviewReference(p: Principal | null, referenceId: string, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  if (!p) return unauthenticated();
  if (p.role !== "REVIEWER") return reviewersOnly();
  const limited = rateLimited(deps.rateLimiter, `reference-review:${p.contributorId}`);
  if (limited) return limited;

  const parsed = ReferenceReviewRequest.safeParse(body);
  if (!parsed.success) return invalid("INVALID_REQUEST", "Expected { decision: SOURCE_CONFIRMED | SOURCE_REJECTED, reason (3+ chars) }.", parsed.error);

  const notFound = fail(404, "NOT_FOUND", "Reference not found.");
  if (!UUID_RE.test(referenceId)) return notFound;
  const ref = await deps.storage.repo.getReference(referenceId);
  if (!ref) return notFound;
  if (ref.createdBy === p.contributorId) {
    return fail(403, "SELF_REVIEW", "You imported this reference, so another reviewer must check its source.");
  }

  const createdAt = nowIso(deps);
  const record: ReferenceReviewRecord = {
    id: newIdOf(deps),
    referenceId: ref.id,
    reviewerId: p.contributorId,
    decision: parsed.data.decision,
    reason: parsed.data.reason.trim(),
    createdAt,
  };
  await deps.storage.repo.insertReferenceReview(record);
  const reviews = await deps.storage.repo.listReferenceReviews([ref.id]);

  await deps.storage.repo.appendAudit({
    id: newIdOf(deps),
    evidenceId: null,
    actorId: p.contributorId,
    eventType: AUDIT_REFERENCE_REVIEWED,
    metadata: {
      referenceId: ref.id,
      referenceReviewId: record.id,
      decision: record.decision,
      sourceVerifiedAfter: sourceVerifiedFrom(reviews),
      reviewStateAfter: reviewStateFrom(reviews),
      synthetic: ref.synthetic,
    },
    createdAt,
  });
  return { status: 201, body: toReferenceView(ref, reviews, p.contributorId) };
}

/* ------------------------------------------------------------------ reads */

function resolveUnit(unitId: string, electionId: string | null): ServiceResult | { electionId: string; pollingUnitId: string } {
  if (!electionId) return fail(400, "MISSING_ELECTION", "Query parameter electionId is required.");
  if (!findElection(electionId)) return fail(404, "UNKNOWN_ELECTION", "Unknown election.");
  if (!findPollingUnit(unitId)) return fail(404, "UNKNOWN_POLLING_UNIT", "Unknown polling unit.");
  return { electionId, pollingUnitId: unitId };
}

export async function listUnitReferences(p: Principal | null, unitId: string, electionId: string | null, deps: WorkflowDeps): Promise<ServiceResult> {
  if (!p) return unauthenticated();
  if (p.role !== "REVIEWER") return reviewersOnly();
  const unit = resolveUnit(unitId, electionId);
  if ("status" in unit) return unit;
  const refs = await deps.storage.repo.listReferences(unit.electionId, unit.pollingUnitId);
  const reviews = await deps.storage.repo.listReferenceReviews(refs.map((r) => r.id));
  return { status: 200, body: refs.map((r) => toReferenceView(r, reviews, p.contributorId)) };
}

/**
 * Engine input for one evidence row. A decision only counts if it came after the latest
 * revision: figures changed after review have not been re-assessed (status PENDING_REVIEW).
 */
export function toEvidenceInput(
  e: EvidenceRecord,
  revisions: RevisionRecord[],
  reviews: ReviewEventRecord[],
  refFor: (contributorId: string) => string,
): VerificationEvidenceInput {
  const latest = latestRevision(revisions);
  const lastReview = reviews.at(-1) ?? null;
  const decisionIsCurrent = lastReview !== null && (!latest || lastReview.createdAt >= latest.createdAt);
  return {
    evidenceId: e.id,
    sha256: e.sha256,
    contributorRef: refFor(e.contributorId),
    receivedAt: e.receivedAt,
    synthetic: e.synthetic,
    latestDecision: decisionIsCurrent ? lastReview.decision : null,
    independence: lastReview?.independenceStatus ?? "UNVERIFIED",
    confirmed:
      latest && latest.humanConfirmed
        ? {
            revisionNumber: latest.revisionNumber,
            formType: latest.formType,
            figures: Object.fromEntries(latest.entries.map((x) => [x.partyCode, x.votes])),
          }
        : null,
  };
}

/** PUBLIC. Redacted by construction: the engine output carries no contributor data. */
export async function getUnitVerification(unitId: string, electionId: string | null, deps: WorkflowDeps): Promise<ServiceResult> {
  const unit = resolveUnit(unitId, electionId);
  if ("status" in unit) return unit;
  const { repo } = deps.storage;

  const evidence = await repo.listEvidenceForUnit(unit.electionId, unit.pollingUnitId);
  const ids = evidence.map((e) => e.id);
  const [revisions, reviews, refs] = await Promise.all([
    repo.listRevisions(ids),
    repo.listReviews(ids),
    repo.listReferences(unit.electionId, unit.pollingUnitId),
  ]);
  // Compare against the latest SOURCE-CONFIRMED version. A newer unreviewed/rejected version
  // (e.g. imported by one reviewer to mask a confirmed discrepancy) cannot displace it; it shows
  // up for reviewers in GET /api/units/:id/references until a second reviewer confirms it.
  // With no confirmed version, the latest version is used (and the engine treats it as unconfirmed).
  const allRefReviews = await repo.listReferenceReviews(refs.map((r) => r.id));
  const reviewsOf = (id: string) => allRefReviews.filter((x) => x.referenceId === id);
  const latestRef = [...refs].reverse().find((r) => reviewStateFrom(reviewsOf(r.id)) === "CONFIRMED") ?? refs.at(-1) ?? null;
  const refReviews = latestRef ? reviewsOf(latestRef.id) : [];

  const reference: VerificationReferenceInput | null = latestRef
    ? {
        id: latestRef.id,
        version: latestRef.version,
        sourceType: latestRef.sourceType,
        sourceDescription: latestRef.sourceDescription,
        sourceUrl: latestRef.sourceUrl,
        sourceVerified: sourceVerifiedFrom(refReviews),
        reviewState: reviewStateFrom(refReviews),
        synthetic: latestRef.synthetic,
        figures: { ...latestRef.figures },
      }
    : null;

  const result: UnitVerification = computeVerification({
    electionId: unit.electionId,
    pollingUnitId: unit.pollingUnitId,
    partyRoster: [...PARTY_ROSTER],
    evidence: evidence.map((e) =>
      toEvidenceInput(
        e,
        revisions.filter((r) => r.evidenceId === e.id),
        reviews.filter((r) => r.evidenceId === e.id),
        unitVerificationRef,
      ),
    ),
    reference,
  });
  return { status: 200, body: result };
}
