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
import { availableModes, consistencyWarnings, ExtractionError, normalisePollingUnitCode, runExtraction, validateConfirm, type ExtractionRun } from "@/lib/extraction";
import { findPollingUnit, partyRosterFor } from "@/lib/seed/registry";
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
  /** Extraction runner override (tests inject provider outcomes). Defaults to runExtraction. */
  extractor?: typeof runExtraction;
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
    // A sheet showing a different polling unit cannot be accepted for this unit (flag or reject instead).
    const registryCode = findPollingUnit(evidence.pollingUnitId)?.code ?? evidence.pollingUnitId;
    const sheetCode = latest.pollingUnitCodeOnSheet;
    if (sheetCode && normalisePollingUnitCode(sheetCode) !== normalisePollingUnitCode(registryCode)) {
      return fail(409, "PU_CODE_MISMATCH", "The polling unit code on the sheet does not match this polling unit. Flag or reject it instead.", {
        sheetCode,
        registryCode,
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

/* ------------------------------------------------------------------ extraction (owner only) */

export const AUDIT_EXTRACTION_STARTED = "EXTRACTION_STARTED";
export const AUDIT_EXTRACTION_FAILED = "EXTRACTION_FAILED";
/** Closes an attempt that yielded to a concurrent one (never called the provider). */
export const AUDIT_EXTRACTION_ABANDONED = "EXTRACTION_ABANDONED";
export const MAX_REAL_VISION_ATTEMPTS = 3;
export const EXTRACTION_LOCK_MS = 90_000;
const MAX_NOTES = 5;
const MAX_NOTE_LENGTH = 300;

type ExtractionFailureCode = "MODE_UNAVAILABLE" | "NOT_CONFIGURED" | "INVALID_DRAFT" | "UNSUPPORTED_DOCUMENT" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR" | "REFUSED";

/** Model notes are untrusted text: plain, short, few. Never rendered as HTML by contract. */
const safeNotes = (details: readonly string[] | undefined) =>
  (details ?? [])
    .slice(0, MAX_NOTES)
    .map((d) => String(d).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_NOTE_LENGTH))
    .filter(Boolean);

/** Defence in depth: never persist anything that looks like a credential or raw HTTP headers. */
const SECRETISH_KEY = /api[-_]?key|authorization|secret|password|token|^headers$|cookie/i;
function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !SECRETISH_KEY.test(k))
      .map(([k, x]) => [k, scrub(x, depth + 1)]),
  );
}

function mapExtractionError(code: ExtractionFailureCode, message: string, details: readonly string[] | undefined): ServiceResult {
  switch (code) {
    case "MODE_UNAVAILABLE":
    case "NOT_CONFIGURED":
      return fail(422, "MODE_UNAVAILABLE", message);
    case "UNSUPPORTED_DOCUMENT":
      return fail(422, "EXTRACTION_UNSUPPORTED_DOCUMENT", message, { notes: safeNotes(details) });
    case "PROVIDER_TIMEOUT":
      return fail(504, "EXTRACTION_TIMEOUT", "Automatic reading took too long. Nothing was stored; enter the figures by hand or try again.");
    case "INVALID_DRAFT":
    case "REFUSED":
    case "PROVIDER_ERROR":
      return fail(502, "EXTRACTION_REJECTED", "Automatic reading did not produce usable figures. Nothing was stored; enter the figures by hand.");
  }
}

/**
 * REAL_VISION attempt bookkeeping from the append-only audit log (no extra table):
 *  - attempts = EXTRACTION_CREATED + EXTRACTION_FAILED rows with mode REAL_VISION
 *  - open attempts = EXTRACTION_STARTED within the lock window with no CREATED/FAILED/ABANDONED
 *    carrying the same attemptId
 */
async function visionAttemptState(deps: WorkflowDeps, evidenceId: string, nowMs: number) {
  const audit = await deps.storage.repo.listAudit(evidenceId);
  const closed = new Set(
    audit
      .filter((a) => [AUDIT_EXTRACTION_CREATED, AUDIT_EXTRACTION_FAILED, AUDIT_EXTRACTION_ABANDONED].includes(a.eventType))
      .map((a) => String(a.metadata.attemptId ?? "")),
  );
  const attempts = audit.filter(
    (a) => (a.eventType === AUDIT_EXTRACTION_CREATED || a.eventType === AUDIT_EXTRACTION_FAILED) && a.metadata.mode === "REAL_VISION",
  ).length;
  const open = audit
    .filter(
      (a) =>
        a.eventType === AUDIT_EXTRACTION_STARTED &&
        nowMs - Date.parse(a.createdAt) < EXTRACTION_LOCK_MS &&
        !closed.has(String(a.metadata.attemptId ?? "")),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { attempts, open };
}

export async function extractEvidence(p: Principal | null, id: string, body: unknown, deps: WorkflowDeps): Promise<ServiceResult> {
  const loaded = await loadVisibleEvidence(p, id, deps.storage);
  if (!loaded.ok) return loaded.result;
  const { evidence, principal, relation } = loaded;
  // Owner only: a reviewer adding a draft would silently withdraw an acceptance.
  if (relation !== "OWNER") {
    return fail(403, "OWNER_ONLY", "Only the person who submitted this photo can read figures from it. Reviewers record a decision instead.");
  }

  const limited = rateLimited(deps.rateLimiter, `extract:${principal.contributorId}`);
  if (limited) return limited;

  const parsed = ExtractRequest.safeParse(body ?? {});
  if (!parsed.success) return invalid("INVALID_REQUEST", "Expected { mode?: AUTO | REAL_VISION | MANUAL | DEMO_FIXTURE }.", parsed.error);
  const requested = parsed.data.mode;

  const envArgs = deps.extractionEnv ? [deps.extractionEnv] : [];
  const modesNow = availableModes({ synthetic: evidence.synthetic }, ...envArgs);
  const planned = requested === "AUTO" ? (modesNow[0] ?? "MANUAL") : requested;
  const vision = planned === "REAL_VISION";
  const nowMs = () => (deps.now ?? (() => new Date()))().getTime();
  const attemptId = newIdOf(deps);
  const { repo } = deps.storage;
  const audit = (eventType: string, metadata: Record<string, unknown>) =>
    repo.appendAudit({
      id: newIdOf(deps),
      evidenceId: evidence.id,
      actorId: principal.contributorId,
      eventType,
      metadata: { attemptId, synthetic: evidence.synthetic, ...metadata },
      createdAt: new Date(nowMs()).toISOString(),
    });

  // Paid / slow provider calls: per-evidence cap and single-flight (manual & demo are unaffected).
  if (vision) {
    const before = await visionAttemptState(deps, evidence.id, nowMs());
    if (before.attempts >= MAX_REAL_VISION_ATTEMPTS) {
      return fail(429, "EXTRACTION_LIMIT_REACHED", `Automatic reading was already tried ${MAX_REAL_VISION_ATTEMPTS} times for this photo. Enter the figures by hand.`);
    }
    if (before.open.length > 0) {
      return fail(409, "EXTRACTION_IN_PROGRESS", "Figures are already being read from this photo. Wait a moment and reload.");
    }
    await audit(AUDIT_EXTRACTION_STARTED, { mode: "REAL_VISION", requestedMode: requested });
    // Narrow the check-then-insert race: after our insert, the earliest open attempt wins.
    const after = await visionAttemptState(deps, evidence.id, nowMs());
    const winner = after.open[0];
    if (winner && String(winner.metadata.attemptId) !== attemptId) {
      await audit(AUDIT_EXTRACTION_ABANDONED, { mode: "REAL_VISION", yieldedTo: winner.metadata.attemptId });
      return fail(409, "EXTRACTION_IN_PROGRESS", "Figures are already being read from this photo. Wait a moment and reload.");
    }
  }

  const bytes = await deps.storage.objects.get(evidence.originalPath);
  if (!bytes) {
    if (vision) await audit(AUDIT_EXTRACTION_FAILED, { mode: planned, code: "ORIGINAL_MISSING", durationMs: 0 });
    return fail(409, "ORIGINAL_MISSING", "The original file is not available, so nothing can be read from it.");
  }
  const unit = findPollingUnit(evidence.pollingUnitId);

  const startedMs = nowMs();
  let run: ExtractionRun;
  try {
    run = await (deps.extractor ?? runExtraction)(
      {
        evidenceId: evidence.id,
        bytes,
        mime: evidence.mime,
        synthetic: evidence.synthetic,
        pollingUnitCode: unit?.code ?? evidence.pollingUnitId,
        partyRoster: partyRosterFor(evidence.electionId),
      },
      requested,
      ...envArgs,
    );
  } catch (err) {
    const durationMs = Math.max(0, nowMs() - startedMs);
    const code = (err as { code?: unknown })?.code;
    const known = err instanceof ExtractionError || typeof code === "string";
    await audit(AUDIT_EXTRACTION_FAILED, {
      mode: planned,
      provider: vision ? "anthropic" : null,
      model: null,
      code: known ? String(code) : "UNEXPECTED",
      durationMs,
    });
    if (known) {
      const mapped = mapExtractionError(code as ExtractionFailureCode, (err as Error).message, (err as { details?: readonly string[] }).details);
      if (mapped) return mapped;
    }
    throw err;
  }

  const { draft, modeUsed } = run;
  const durationMs = run.provenance?.durationMs ?? Math.max(0, nowMs() - startedMs);
  const rawExtraction = scrub({
    draft,
    uncertainFields: [...(run.uncertainFields ?? [])],
    ...(run.provenance
      ? {
          provider: run.provenance.provider,
          model: run.provenance.model,
          extractedAt: run.provenance.extractedAt,
          durationMs: run.provenance.durationMs,
          modelOutput: run.rawModelOutput ?? null,
        }
      : {}),
  });

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
    rawExtraction,
    humanConfirmed: false,
    basedOnRevision: null,
    note: null,
    createdBy: principal.contributorId,
    createdAt,
  }));
  if (!stored) {
    if (vision) await audit(AUDIT_EXTRACTION_FAILED, { mode: modeUsed, code: "REVISION_CONFLICT", durationMs });
    return fail(409, "REVISION_CONFLICT", "Another revision was being written at the same time. Try again.");
  }
  // A new revision after a decision sends the evidence back to a reviewer.
  const newStatus = await syncStatus(deps, evidence);

  await audit(AUDIT_EXTRACTION_CREATED, {
    revisionNumber: stored.revisionNumber,
    mode: modeUsed,
    requestedMode: requested,
    provider: run.provenance?.provider ?? null,
    model: run.provenance?.model ?? null,
    durationMs,
    uncertainFields: (run.uncertainFields ?? []).length,
    previousStatus,
    newStatus,
    statusResetAfterReview: previousStatus === "ACCEPTED" || previousStatus === "REJECTED",
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

  const checked = validateConfirm(req, partyRosterFor(evidence.electionId));
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

/** Exact timeline wording for AI-assisted reading (lead-approved design brief). */
export const AI_SUGGESTED_SUMMARY = "An AI model suggested figures — not checked yet.";
export const AI_CONFIRMED_SUMMARY = "A person checked the figures against the photo and confirmed them.";

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
      const base = r.basedOnRevision ? revisions.find((x) => x.revisionNumber === r.basedOnRevision) : undefined;
      events.push({
        type: "HUMAN_CONFIRMATION",
        at: r.createdAt,
        // Exact wording (design brief) when a person checked an AI suggestion.
        summary:
          base?.origin === "REAL_VISION"
            ? AI_CONFIRMED_SUMMARY
            : `Revision ${r.revisionNumber}: the submitter typed or checked the figures` +
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
        summary: mode === "REAL_VISION" ? AI_SUGGESTED_SUMMARY : `Revision ${r.revisionNumber}: ${EXTRACTION_SUMMARY[mode] ?? "a draft was created."}`,
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
      canExtract: owner, // owner only (2026-11-20)
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
