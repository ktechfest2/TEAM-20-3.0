/**
 * Reviewer workflow, result revisions and the ProofTrail trace (server-only).
 * Frozen contracts: src/lib/contracts/trace.ts. Revisions and review events are append-only;
 * evidence.status is the only thing that changes, and every change is audited.
 * Wording rule for anything shown to people: neutral. Never "verified", "authentic", "fraud".
 */
import { randomUUID } from "node:crypto";
import { ReviewRequest, type EvidenceStatus, type ReviewDecision } from "@/lib/contracts";
import {
  ConfirmRequest,
  EvidenceTrace,
  ExtractRequest,
  type ExtractResponse,
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type TraceEvent,
} from "@/lib/contracts/trace";
import { reviewerRef, type Principal } from "@/lib/auth/session";
import { availableModes, consistencyWarnings, ExtractionError, runExtraction, validateConfirm } from "@/lib/extraction";
import { findPollingUnit, PARTY_ROSTER } from "@/lib/seed/registry";
import type { EvidenceRecord, EvidenceStorage, RevisionRecord } from "@/lib/storage";
import { evidenceNotFound, loadVisibleEvidence, reviewersOnly, unauthenticated } from "./access";
import type { RateLimiter } from "./rate-limit";
import { AUDIT_EVIDENCE_RECEIVED, fail, invalid, rateLimited, type ServiceResult } from "./service";
import { deriveEvidenceStatus, latestRevision, toReviewView, toRevisionView } from "./views";

export interface WorkflowDeps {
  storage: EvidenceStorage;
  rateLimiter: RateLimiter;
  now?: () => Date;
  newId?: () => string;
  /** Extraction env override (tests). Defaults to process.env inside the extraction module. */
  extractionEnv?: Record<string, string | undefined>;
}

export const AUDIT_REVIEW_RECORDED = "REVIEW_RECORDED";
export const AUDIT_EXTRACTION_CREATED = "EXTRACTION_CREATED";
export const AUDIT_HUMAN_CONFIRMED = "HUMAN_CONFIRMED";

const QUEUE_STATUSES: EvidenceStatus[] = ["RECEIVED", "PENDING_REVIEW"]; // FLAGGED evidence sits in PENDING_REVIEW
const QUEUE_LIMIT = 200;
const MAX_REVISION_RETRIES = 5;

const nowIso = (d: WorkflowDeps) => (d.now ?? (() => new Date()))().toISOString();
const newIdOf = (d: WorkflowDeps) => (d.newId ?? randomUUID)();
const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Synthetic if the evidence is synthetic or the reviewer is a synthetic demo identity. */
async function reviewSyntheticFlags(storage: EvidenceStorage, reviewerIds: string[], evidenceSynthetic: boolean) {
  const out = new Map<string, boolean>();
  for (const id of new Set(reviewerIds)) {
    const c = await storage.repo.getContributor(id);
    out.set(id, evidenceSynthetic || Boolean(c?.synthetic));
  }
  return out;
}

/**
 * Recompute status from history (after the new event was appended) and write the cached
 * column if it differs. Event first, status second: if this write fails, reads still show
 * the derived status and the next write repairs the column.
 */
async function syncStatus(deps: WorkflowDeps, evidence: EvidenceRecord) {
  const { repo } = deps.storage;
  const [revisions, reviews] = await Promise.all([repo.listRevisions([evidence.id]), repo.listReviews([evidence.id])]);
  const newStatus = deriveEvidenceStatus(revisions, reviews);
  if (newStatus !== evidence.status) await repo.updateEvidenceStatus(evidence.id, newStatus);
  return newStatus;
}

async function derivedStatusOf(deps: WorkflowDeps, evidenceId: string) {
  const { repo } = deps.storage;
  const [revisions, reviews] = await Promise.all([repo.listRevisions([evidenceId]), repo.listReviews([evidenceId])]);
  return deriveEvidenceStatus(revisions, reviews);
}

/* ------------------------------------------------------------------ queue */

export async function getReviewQueue(p: Principal | null, deps: WorkflowDeps): Promise<ServiceResult> {
  if (!p) return unauthenticated();
  if (p.role !== "REVIEWER") return reviewersOnly();
  const { repo } = deps.storage;

  const evidence = await repo.listEvidenceByStatus(QUEUE_STATUSES, QUEUE_LIMIT);
  const ids = evidence.map((e) => e.id);
  const [revisions, reviews, shaCounts] = await Promise.all([
    repo.listRevisions(ids),
    repo.listReviews(ids),
    repo.countEvidenceBySha(evidence.map((e) => e.sha256)),
  ]);

  const items: ReviewQueueItem[] = evidence.flatMap((e) => {
    const unit = findPollingUnit(e.pollingUnitId);
    const evRevisions = revisions.filter((r) => r.evidenceId === e.id);
    const latest = latestRevision(evRevisions);
    const evReviews = reviews.filter((r) => r.evidenceId === e.id);
    const status = deriveEvidenceStatus(evRevisions, evReviews);
    if (!QUEUE_STATUSES.includes(status)) return []; // history says decided; stale cached column
    return [{
      id: e.id,
      electionId: e.electionId,
      pollingUnitId: e.pollingUnitId,
      pollingUnitCode: unit?.code ?? e.pollingUnitId,
      pollingUnitName: unit?.name ?? "Unknown polling unit",
      sha256: e.sha256,
      receivedAt: e.receivedAt,
      status,
      sourceType: e.sourceType,
      synthetic: e.synthetic,
      latestRevision: latest
        ? { revisionNumber: latest.revisionNumber, origin: latest.origin, humanConfirmed: latest.humanConfirmed }
        : null,
      exactDuplicateCount: Math.max(0, (shaCounts[e.sha256] ?? 1) - 1),
      reviewCount: evReviews.length,
      lastDecision: evReviews.at(-1)?.decision ?? null,
      submittedByViewer: e.contributorId === p.contributorId,
    }];
  });

  const body: ReviewQueueResponse = { items, synthetic: p.synthetic || items.some((i) => i.synthetic) };
  return { status: 200, body };
}

/* ------------------------------------------------------------------ review */

export async function reviewEvidence(p: Principal | null, id: string, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  if (!p) return unauthenticated();
  // Role check first: a contributor learns nothing about whether the id exists.
  if (p.role !== "REVIEWER") return reviewersOnly();
  const limited = rateLimited(deps.rateLimiter, `review:${p.contributorId}`);
  if (limited) return limited;

  const parsed = ReviewRequest.safeParse(body);
  if (!parsed.success) return invalid("INVALID_REQUEST", "Expected { decision, independenceStatus, reason (3+ chars) }.", parsed.error);

  const loaded = await loadVisibleEvidence(p, id, deps.storage);
  if (!loaded.ok) return loaded.result;
  const { evidence } = loaded;
  if (evidence.contributorId === p.contributorId) {
    return fail(403, "SELF_REVIEW", "You submitted this evidence, so you cannot review it.");
  }

  const { repo } = deps.storage;
  const req = parsed.data;
  if (req.decision === "ACCEPTED") {
    const latest = latestRevision(await repo.listRevisions([evidence.id]));
    if (!latest?.humanConfirmed) {
      return fail(409, "NO_CONFIRMED_REVISION", "Accepting needs figures confirmed by the submitter (the latest revision is not human-confirmed).", {
        latestRevision: latest?.revisionNumber ?? null,
      });
    }
  }

  const previousStatus = await derivedStatusOf(deps, evidence.id);
  const createdAt = nowIso(deps);
  const record = {
    id: newIdOf(deps),
    evidenceId: evidence.id,
    reviewerId: p.contributorId,
    decision: req.decision,
    independenceStatus: req.independenceStatus,
    reason: req.reason.trim(),
    createdAt,
  };
  await repo.insertReview(record); // source of truth, written first
  const newStatus = await syncStatus(deps, evidence);

  await repo.appendAudit({
    id: newIdOf(deps),
    evidenceId: evidence.id,
    actorId: p.contributorId,
    eventType: AUDIT_REVIEW_RECORDED,
    metadata: {
      reviewEventId: record.id,
      decision: req.decision,
      independenceStatus: req.independenceStatus,
      previousStatus,
      newStatus,
      synthetic: evidence.synthetic || p.synthetic,
    },
    createdAt,
  });

  return {
    status: 201,
    body: {
      review: toReviewView(record, p.contributorId, evidence.synthetic || p.synthetic, reviewerRef),
      status: newStatus,
    },
  };
}

/* ------------------------------------------------------------------ revisions */

/** Inserts at latest+1, retrying if a concurrent writer took that number. */
async function appendRevisionWithRetry(
  deps: WorkflowDeps,
  evidenceId: string,
  build: (revisionNumber: number) => RevisionRecord,
): Promise<RevisionRecord | null> {
  for (let attempt = 0; attempt < MAX_REVISION_RETRIES; attempt++) {
    const latest = latestRevision(await deps.storage.repo.listRevisions([evidenceId]));
    const result = await deps.storage.repo.insertRevision(build((latest?.revisionNumber ?? 0) + 1));
    if (result.inserted) return result.record;
  }
  return null;
}

export async function extractEvidence(p: Principal | null, id: string, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  const loaded = await loadVisibleEvidence(p, id, deps.storage);
  if (!loaded.ok) return loaded.result;
  const { evidence, principal } = loaded;

  const limited = rateLimited(deps.rateLimiter, `extract:${principal.contributorId}`);
  if (limited) return limited;

  const parsed = ExtractRequest.safeParse(body ?? {});
  if (!parsed.success) return invalid("INVALID_REQUEST", "Expected { mode?: AUTO | REAL_VISION | MANUAL | DEMO_FIXTURE }.", parsed.error);

  const bytes = await deps.storage.objects.get(evidence.originalPath);
  if (!bytes) return fail(409, "ORIGINAL_MISSING", "The original file is not available, so nothing can be read from it.");
  const unit = findPollingUnit(evidence.pollingUnitId);

  let run: Awaited<ReturnType<typeof runExtraction>>;
  try {
    run = await runExtraction(
      {
        evidenceId: evidence.id,
        bytes,
        mime: evidence.mime,
        synthetic: evidence.synthetic,
        pollingUnitCode: unit?.code ?? evidence.pollingUnitId,
        partyRoster: PARTY_ROSTER,
      },
      parsed.data.mode,
      ...(deps.extractionEnv ? [deps.extractionEnv] : []),
    );
  } catch (err) {
    if (err instanceof ExtractionError || (err as { code?: string })?.code) {
      const code = (err as { code: string }).code;
      if (code === "MODE_UNAVAILABLE" || code === "NOT_CONFIGURED") {
        return fail(422, "MODE_UNAVAILABLE", (err as Error).message);
      }
      if (code === "INVALID_DRAFT") {
        return fail(502, "EXTRACTION_REJECTED", "The extractor's output failed validation. Nothing was stored.");
      }
    }
    throw err;
  }

  const { draft, modeUsed } = run;
  const previousStatus = await derivedStatusOf(deps, evidence.id);
  const createdAt = nowIso(deps);
  const stored = await appendRevisionWithRetry(deps, evidence.id, (revisionNumber) => ({
    id: newIdOf(deps),
    evidenceId: evidence.id,
    revisionNumber,
    origin: modeUsed,
    extractionMode: modeUsed,
    formType: draft.formType,
    pollingUnitCodeOnSheet: draft.pollingUnitCode,
    entries: draft.entries,
    accreditedVoters: draft.accreditedVoters,
    rejectedVotes: draft.rejectedVotes,
    validVotes: draft.validVotes,
    warnings: dedupe(draft.warnings),
    rawExtraction: draft,
    humanConfirmed: false,
    basedOnRevision: null,
    note: null,
    createdBy: principal.contributorId,
    createdAt,
  }));
  if (!stored) return fail(409, "REVISION_CONFLICT", "Another revision was being written at the same time. Try again.");
  // A new revision after a decision sends the evidence back to a reviewer.
  const newStatus = await syncStatus(deps, evidence);

  await deps.storage.repo.appendAudit({
    id: newIdOf(deps),
    evidenceId: evidence.id,
    actorId: principal.contributorId,
    eventType: AUDIT_EXTRACTION_CREATED,
    metadata: {
      revisionNumber: stored.revisionNumber,
      mode: modeUsed,
      requestedMode: parsed.data.mode,
      previousStatus,
      newStatus,
      statusResetAfterReview: previousStatus === "ACCEPTED" || previousStatus === "REJECTED",
      synthetic: evidence.synthetic,
    },
    createdAt,
  });

  const response: ExtractResponse = {
    revision: toRevisionView(stored, principal.contributorId),
    modeUsed,
    availableModes: run.availableModes,
    notice: run.notice,
  };
  return { status: 201, body: response };
}

export async function confirmEvidence(p: Principal | null, id: string, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  const loaded = await loadVisibleEvidence(p, id, deps.storage);
  if (!loaded.ok) return loaded.result;
  const { evidence, relation, principal } = loaded;
  if (relation !== "OWNER") {
    return fail(403, "OWNER_ONLY", "Only the person who submitted this photo can confirm its figures. Reviewers record a decision instead.");
  }
  const limited = rateLimited(deps.rateLimiter, `confirm:${principal.contributorId}`);
  if (limited) return limited;

  const parsed = ConfirmRequest.safeParse(body);
  if (!parsed.success) return invalid("INVALID_REQUEST", "Confirmation failed validation.", parsed.error);
  const req = parsed.data;

  const { repo } = deps.storage;
  const latest = latestRevision(await repo.listRevisions([evidence.id]));
  if (!latest || req.basedOnRevision !== latest.revisionNumber) {
    return fail(409, "STALE_REVISION", latest ? "The figures changed since you opened them. Reload and confirm the latest revision." : "Read the figures first (POST /extract) before confirming.", {
      latestRevision: latest?.revisionNumber ?? null,
    });
  }

  const checked = validateConfirm(req, PARTY_ROSTER);
  if (!checked.ok) return fail(400, "INVALID_FIGURES", "Some figures need fixing before they can be confirmed.", { issues: checked.issues });

  const unit = findPollingUnit(evidence.pollingUnitId);
  const warnings = dedupe([
    ...checked.warnings,
    ...consistencyWarnings(
      {
        entries: checked.entries,
        accreditedVoters: req.accreditedVoters,
        rejectedVotes: req.rejectedVotes,
        validVotes: req.validVotes,
        pollingUnitCode: req.pollingUnitCodeOnSheet,
      },
      unit?.code ?? evidence.pollingUnitId,
    ),
  ]);

  const previousStatus = await derivedStatusOf(deps, evidence.id);
  const createdAt = nowIso(deps);
  const inserted = await repo.insertRevision({
    id: newIdOf(deps),
    evidenceId: evidence.id,
    revisionNumber: latest.revisionNumber + 1,
    origin: "HUMAN_CORRECTION",
    extractionMode: null,
    formType: req.formType,
    pollingUnitCodeOnSheet: req.pollingUnitCodeOnSheet,
    entries: checked.entries,
    accreditedVoters: req.accreditedVoters,
    rejectedVotes: req.rejectedVotes,
    validVotes: req.validVotes,
    warnings,
    rawExtraction: { submitted: req },
    humanConfirmed: true,
    basedOnRevision: req.basedOnRevision,
    note: req.note?.trim() || null,
    createdBy: principal.contributorId,
    createdAt,
  });
  // Someone wrote revision latest+1 between our read and insert: the client's base is stale.
  if (!inserted.inserted) {
    return fail(409, "STALE_REVISION", "The figures changed since you opened them. Reload and confirm the latest revision.", {
      latestRevision: latest.revisionNumber + 1,
    });
  }

  // A new human revision always goes back to a reviewer, even after ACCEPTED/REJECTED.
  const newStatus = await syncStatus(deps, evidence);

  await repo.appendAudit({
    id: newIdOf(deps),
    evidenceId: evidence.id,
    actorId: principal.contributorId,
    eventType: AUDIT_HUMAN_CONFIRMED,
    metadata: {
      revisionNumber: inserted.record.revisionNumber,
      basedOnRevision: req.basedOnRevision,
      previousStatus,
      newStatus,
      statusResetAfterReview: previousStatus === "ACCEPTED" || previousStatus === "REJECTED",
      unreadableFields: checked.entries.filter((e) => e.votes === null).length,
      synthetic: evidence.synthetic,
    },
    createdAt,
  });

  return { status: 201, body: toRevisionView(inserted.record, principal.contributorId) };
}

/* ------------------------------------------------------------------ trace */

const fmtTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

const EXTRACTION_SUMMARY: Record<string, string> = {
  DEMO_FIXTURE: "demo figures from a synthetic fixture were loaded. They were not read from this photo.",
  REAL_VISION: "figures were read from the photo by an automated vision model. They need a person to check them.",
  MANUAL: "a blank form was opened for manual entry. No figures were read automatically.",
};

const DECISION_SUMMARY: Record<ReviewDecision, string> = {
  ACCEPTED: "A reviewer accepted this evidence for comparison.",
  REJECTED: "A reviewer rejected this evidence; it will not be used in comparison.",
  FLAGGED: "A reviewer flagged this evidence for another look.",
};
const INDEPENDENCE_SUMMARY = {
  UNVERIFIED: "Independence from other submissions: not established.",
  REVIEWER_CONFIRMED: "Independence from other submissions: the reviewer judged it independent.",
  DISPUTED: "Independence from other submissions: disputed.",
} as const;

const TYPE_ORDER: Record<TraceEvent["type"], number> = {
  CAPTURE_CLAIMED: 0,
  RECEIVED: 1,
  EXTRACTION: 2,
  HUMAN_CONFIRMATION: 3,
  REVIEW: 4,
};

/** Exported for tests: the wording is part of the integrity contract. */
export function buildTimeline(
  e: EvidenceRecord,
  revisions: RevisionRecord[],
  reviews: Array<{ id: string; decision: ReviewDecision; independenceStatus: keyof typeof INDEPENDENCE_SUMMARY; createdAt: string }>,
  serverHashMatchedClient: boolean,
): TraceEvent[] {
  const events: TraceEvent[] = [];
  if (e.capturedAtClaimed) {
    events.push({
      type: "CAPTURE_CLAIMED",
      at: e.capturedAtClaimed,
      summary: `Phone clock says the photo was saved at ${fmtTime(e.capturedAtClaimed)}. This is the device's claim, not proof of when it was taken.`,
      ref: null,
      claimOnly: true,
    });
  }
  events.push({
    type: "RECEIVED",
    at: e.receivedAt,
    summary: serverHashMatchedClient
      ? "Server received the file and recomputed its fingerprint; it matched."
      : "Server received the file and recomputed its fingerprint.",
    ref: null,
    claimOnly: false,
  });
  for (const r of revisions) {
    if (r.origin === "HUMAN_CORRECTION") {
      const unreadable = r.entries.filter((x) => x.votes === null).length;
      events.push({
        type: "HUMAN_CONFIRMATION",
        at: r.createdAt,
        summary:
          `Revision ${r.revisionNumber}: the submitter typed or checked the figures` +
          (r.basedOnRevision ? ` (based on revision ${r.basedOnRevision})` : "") +
          "." +
          (unreadable > 0 ? ` ${unreadable} figure${unreadable === 1 ? " was" : "s were"} marked unreadable.` : ""),
        ref: String(r.revisionNumber),
        claimOnly: false,
      });
    } else {
      const mode = r.extractionMode ?? r.origin;
      events.push({
        type: "EXTRACTION",
        at: r.createdAt,
        summary: `Revision ${r.revisionNumber}: ${EXTRACTION_SUMMARY[mode] ?? "a draft was created."}`,
        ref: String(r.revisionNumber),
        claimOnly: false,
      });
    }
  }
  for (const rv of reviews) {
    events.push({
      type: "REVIEW",
      at: rv.createdAt,
      summary: `${DECISION_SUMMARY[rv.decision]} ${INDEPENDENCE_SUMMARY[rv.independenceStatus]}`,
      ref: rv.id,
      claimOnly: false,
    });
  }
  return events
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => a.ev.at.localeCompare(b.ev.at) || TYPE_ORDER[a.ev.type] - TYPE_ORDER[b.ev.type] || a.i - b.i)
    .map(({ ev }) => ev);
}

export async function getTrace(p: Principal | null, id: string, deps: WorkflowDeps): Promise<ServiceResult> {
  const loaded = await loadVisibleEvidence(p, id, deps.storage);
  if (!loaded.ok) return loaded.result;
  const { evidence: e, relation, principal } = loaded;
  const { repo, mode } = deps.storage;

  const [revisions, reviews, audit, shaCounts] = await Promise.all([
    repo.listRevisions([e.id]),
    repo.listReviews([e.id]),
    repo.listAudit(e.id),
    repo.countEvidenceBySha([e.sha256]),
  ]);
  const received = audit.find((a) => a.eventType === AUDIT_EVIDENCE_RECEIVED);
  const serverHashMatchedClient = received?.metadata?.clientSha256Matched === true;
  const syntheticByReviewer = await reviewSyntheticFlags(deps.storage, reviews.map((r) => r.reviewerId), e.synthetic);
  const unit = findPollingUnit(e.pollingUnitId);

  const isReviewer = principal.role === "REVIEWER";
  const owner = relation === "OWNER";
  const reviewBlockedReason = !isReviewer ? "Only reviewers can record a decision." : owner ? "You submitted this evidence." : null;

  const trace = EvidenceTrace.parse({
    evidence: {
      id: e.id,
      electionId: e.electionId,
      pollingUnitId: e.pollingUnitId,
      pollingUnitCode: unit?.code ?? e.pollingUnitId,
      pollingUnitName: unit?.name ?? "Unknown polling unit",
      sourceType: e.sourceType,
      status: deriveEvidenceStatus(revisions, reviews),
      sha256: e.sha256,
      mime: e.mime,
      sizeBytes: e.sizeBytes,
      capturedAtClaimed: e.capturedAtClaimed,
      receivedAt: e.receivedAt,
      synthetic: e.synthetic,
      storageMode: mode,
    },
    integrity: { serverHashMatchedClient, exactDuplicateCount: Math.max(0, (shaCounts[e.sha256] ?? 1) - 1) },
    revisions: revisions.map((r) => toRevisionView(r, principal.contributorId)),
    reviews: reviews.map((r) => toReviewView(r, principal.contributorId, syntheticByReviewer.get(r.reviewerId) ?? e.synthetic, reviewerRef)),
    timeline: buildTimeline(e, revisions, reviews, serverHashMatchedClient),
    viewer: relation,
    permissions: {
      canExtract: true, // owner or reviewer (anyone else already got 404)
      canConfirm: owner,
      canReview: isReviewer && !owner,
      reviewBlockedReason,
      availableExtractionModes: availableModes({ synthetic: e.synthetic }, ...(deps.extractionEnv ? [deps.extractionEnv] : [])),
    },
    originalUrl: `/api/evidence/${e.id}/original`,
  });
  return { status: 200, body: trace };
}

export { evidenceNotFound };
