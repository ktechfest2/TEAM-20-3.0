/**
 * FROZEN CONTRACTS (lead-owned, 2026-11-19): review, extraction, revisions, evidence trace.
 * Source of truth for docs/CONTRACTS.md routes /extract, /confirm, /review and the ProofTrail
 * view. Agents build against these; change only through the lead.
 */
import { z } from "zod";
import {
  EvidenceSource,
  EvidenceStatus,
  ExtractionMode,
  FormType,
  Independence,
  ResultDraft,
  ResultField,
  ReviewDecision,
  Sha256Hex,
} from "./index";

const Votes = z.number().int().min(0).nullable();

/* ------------------------------------------------------------------ extraction */

/**
 * Which extraction a caller asks for. AUTO = best available
 * (REAL_VISION if configured, else DEMO_FIXTURE for synthetic evidence, else MANUAL).
 */
export const ExtractRequestMode = z.enum(["AUTO", "REAL_VISION", "MANUAL", "DEMO_FIXTURE"]);
export type ExtractRequestMode = z.infer<typeof ExtractRequestMode>;

/**
 * POST /api/evidence/:id/extract — OWNER only (2026-11-20). Creates a machine/manual revision.
 * Errors (UI always offers manual entry after any of them; the original is never touched):
 * 422 MODE_UNAVAILABLE · 422 EXTRACTION_UNSUPPORTED_DOCUMENT (not a result sheet / unreadable)
 * · 502 EXTRACTION_REJECTED (invalid model output) · 504 EXTRACTION_TIMEOUT
 * · 409 EXTRACTION_IN_PROGRESS · 429 EXTRACTION_LIMIT_REACHED (per evidence) · 429 RATE_LIMITED.
 */
export const ExtractRequest = z.object({ mode: ExtractRequestMode.default("AUTO") });
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export interface ExtractionInput {
  evidenceId: string;
  bytes: Uint8Array;
  mime: string;
  synthetic: boolean;
  /** Registry code of the polling unit the capturer chose (to compare with the sheet). */
  pollingUnitCode: string;
  /** Only these party codes are allowed in a draft; anything else becomes a warning. */
  partyRoster: readonly string[];
}

/**
 * Adapter boundary (src/lib/extraction implements; API routes call). Output is untrusted until
 * validated against ResultDraft and confirmed by a human. Adapters never invent confidence
 * scores: uncertainty is `needsReview` per field + `warnings`. Unreadable → null.
 */
export interface ExtractionAdapter {
  readonly mode: ExtractionMode;
  /** Whether this adapter can run for this input in this environment. */
  available(input: Pick<ExtractionInput, "synthetic">): boolean;
  extract(input: ExtractionInput): Promise<ResultDraft>;
}

/* ------------------------------------------------------------------ revisions */

export const RevisionOrigin = z.enum(["REAL_VISION", "MANUAL", "DEMO_FIXTURE", "HUMAN_CORRECTION"]);
export type RevisionOrigin = z.infer<typeof RevisionOrigin>;

/** One immutable revision of the figures read from one evidence photo. */
export const ResultRevisionView = z.object({
  id: z.string(),
  revisionNumber: z.number().int().min(1),
  origin: RevisionOrigin,
  /** For machine/manual drafts: how it was produced. Null for human corrections. */
  extractionMode: ExtractionMode.nullable(),
  formType: FormType,
  pollingUnitCodeOnSheet: z.string().nullable(),
  entries: z.array(ResultField),
  accreditedVoters: Votes,
  rejectedVotes: Votes,
  validVotes: Votes,
  warnings: z.array(z.string()),
  /**
   * Fields the extractor could not read with certainty (e.g. "PARTY_B", "validVotes",
   * "pollingUnitCode"). Each needs a human look; never a confidence score. Empty for human revisions.
   */
  uncertainFields: z.array(z.string()).default([]),
  /** Who produced a machine draft (REAL_VISION only). Null for manual/demo/human revisions. */
  provenance: z
    .object({
      provider: z.string(),
      model: z.string(),
      extractedAt: z.iso.datetime(),
      durationMs: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  humanConfirmed: z.boolean(),
  /** Revision this one was based on (null for the first). */
  basedOnRevision: z.number().int().min(1).nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdByViewer: z.boolean(),
});
export type ResultRevisionView = z.infer<typeof ResultRevisionView>;

export const ExtractResponse = z.object({
  revision: ResultRevisionView,
  modeUsed: ExtractionMode,
  /** Modes that could run for this evidence right now (for the UI's honest labelling). */
  availableModes: z.array(ExtractionMode),
  /** Plain-language note the UI must show, e.g. "Demo figures, not read from this photo." */
  notice: z.string(),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

/**
 * POST /api/evidence/:id/confirm — owner only. Creates a HUMAN_CORRECTION revision with
 * humanConfirmed=true; never edits an earlier revision. `basedOnRevision` must equal the latest
 * revision number (else 409 STALE_REVISION). Null votes are allowed and stay needsReview=true
 * ("I can't read this" is a truthful answer). Party codes must be in the roster (else 400).
 * Moves evidence RECEIVED → PENDING_REVIEW.
 */
export const ConfirmRequest = z.object({
  basedOnRevision: z.number().int().min(1),
  formType: FormType,
  pollingUnitCodeOnSheet: z.string().max(64).nullable(),
  entries: z.array(ResultField).min(1).max(40),
  accreditedVoters: Votes,
  rejectedVotes: Votes,
  validVotes: Votes,
  note: z.string().max(1000).optional(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;

/* ------------------------------------------------------------------ review */

export const ReviewEventView = z.object({
  id: z.string(),
  decision: ReviewDecision,
  independenceStatus: Independence,
  reason: z.string(),
  /** Opaque per-reviewer reference (never identity). */
  reviewerRef: z.string(),
  byViewer: z.boolean(),
  synthetic: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ReviewEventView = z.infer<typeof ReviewEventView>;

/** GET /api/review/queue — reviewer only. Evidence awaiting a decision, oldest first. */
export const ReviewQueueItem = z.object({
  id: z.string(),
  electionId: z.string(),
  pollingUnitId: z.string(),
  pollingUnitCode: z.string(),
  pollingUnitName: z.string(),
  sha256: Sha256Hex,
  receivedAt: z.iso.datetime(),
  status: EvidenceStatus,
  sourceType: EvidenceSource,
  synthetic: z.boolean(),
  latestRevision: z
    .object({ revisionNumber: z.number().int(), origin: RevisionOrigin, humanConfirmed: z.boolean() })
    .nullable(),
  /** Other evidence rows with the identical SHA-256 (exact duplicate originals). */
  exactDuplicateCount: z.number().int().min(0),
  reviewCount: z.number().int().min(0),
  lastDecision: ReviewDecision.nullable(),
  /** True when the viewing reviewer submitted this evidence (cannot review it). */
  submittedByViewer: z.boolean(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItem>;

export const ReviewQueueResponse = z.object({ items: z.array(ReviewQueueItem), synthetic: z.boolean() });
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponse>;

/* ------------------------------------------------------------------ ProofTrail trace */

export const TraceEventType = z.enum([
  "CAPTURE_CLAIMED", // device clock claim, not proof
  "RECEIVED", // server received + re-hashed
  "EXTRACTION", // machine/manual draft revision
  "HUMAN_CONFIRMATION", // human-confirmed revision
  "REVIEW", // reviewer decision
]);
export type TraceEventType = z.infer<typeof TraceEventType>;

export const TraceEvent = z.object({
  type: TraceEventType,
  at: z.iso.datetime(),
  /** Plain-language one-liner, neutral wording (no "verified", no allegations). */
  summary: z.string(),
  /** Revision number or review event id this event refers to. */
  ref: z.string().nullable(),
  /** True when `at` is a device claim rather than a server timestamp. */
  claimOnly: z.boolean(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;

/** GET /api/evidence/:id/trace — owner or reviewer (404 for anyone else). */
export const EvidenceTrace = z.object({
  evidence: z.object({
    id: z.string(),
    electionId: z.string(),
    pollingUnitId: z.string(),
    pollingUnitCode: z.string(),
    pollingUnitName: z.string(),
    sourceType: EvidenceSource,
    status: EvidenceStatus,
    sha256: Sha256Hex,
    mime: z.string(),
    sizeBytes: z.number().int(),
    capturedAtClaimed: z.iso.datetime().nullable(),
    receivedAt: z.iso.datetime(),
    synthetic: z.boolean(),
    storageMode: z.enum(["LOCAL_DEV", "SUPABASE"]),
  }),
  integrity: z.object({
    /** Server recomputed SHA-256 on receipt and it matched the client's claim. */
    serverHashMatchedClient: z.boolean(),
    exactDuplicateCount: z.number().int().min(0),
  }),
  /** All revisions, oldest first. Nothing is ever removed. */
  revisions: z.array(ResultRevisionView),
  /** All review decisions, oldest first. */
  reviews: z.array(ReviewEventView),
  timeline: z.array(TraceEvent),
  viewer: z.enum(["OWNER", "REVIEWER"]),
  permissions: z.object({
    canExtract: z.boolean(),
    canConfirm: z.boolean(),
    canReview: z.boolean(),
    /** Why review is not possible, e.g. "You submitted this evidence." */
    reviewBlockedReason: z.string().nullable(),
    /** Extraction modes that can run for this evidence now (same rule as /extract). */
    availableExtractionModes: z.array(ExtractionMode),
  }),
  /** URL of the original bytes for this viewer (private, no-store). */
  originalUrl: z.string(),
});
export type EvidenceTrace = z.infer<typeof EvidenceTrace>;
