/**
 * Lead-owned shared contracts. Source of truth: docs/CONTRACTS.md.
 * Only one worker changes this file at a time.
 */
import { z } from "zod";

export const EvidenceSource = z.enum(["WITNESS_PHOTO", "OBSERVER_PHOTO"]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export const ExtractionMode = z.enum(["REAL_VISION", "MANUAL", "DEMO_FIXTURE"]);
export type ExtractionMode = z.infer<typeof ExtractionMode>;

/** Submission / reviewer state of one evidence file. */
export const EvidenceStatus = z.enum(["RECEIVED", "PENDING_REVIEW", "ACCEPTED", "REJECTED"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const Independence = z.enum(["UNVERIFIED", "REVIEWER_CONFIRMED", "DISPUTED"]);
export type Independence = z.infer<typeof Independence>;

/** Aggregate comparison state for an election + polling unit. Never "verified". */
export const VerificationStatus = z.enum([
  "NO_EVIDENCE",
  "PENDING_REVIEW",
  "MATCHING_SUBMISSIONS",
  "CORROBORATED",
  "CONFLICTING_EVIDENCE",
  "REFERENCE_DISCREPANCY",
  "INCONCLUSIVE",
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const ReferenceType = z.enum(["MANUAL_IREV", "HISTORICAL_DATASET", "SYNTHETIC_DEMO"]);
export type ReferenceType = z.infer<typeof ReferenceType>;

export const FormType = z.enum(["EC8A", "EC60E", "UNKNOWN"]);
export type FormType = z.infer<typeof FormType>;

const Votes = z.number().int().min(0).nullable();

export const ResultField = z.object({
  partyCode: z.string().min(1).max(32),
  votes: Votes,
  needsReview: z.boolean(),
});
export type ResultField = z.infer<typeof ResultField>;

export const ResultDraft = z.object({
  formType: FormType,
  pollingUnitCode: z.string().nullable(),
  entries: z.array(ResultField),
  accreditedVoters: Votes,
  rejectedVotes: Votes,
  validVotes: Votes,
  warnings: z.array(z.string()),
  mode: ExtractionMode,
});
export type ResultDraft = z.infer<typeof ResultDraft>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "Expected lowercase hex SHA-256");

export const Election = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  date: z.string(),
  synthetic: z.boolean(),
});
export type Election = z.infer<typeof Election>;

export const PollingUnit = z.object({
  id: z.string(),
  registrySource: z.string(),
  code: z.string(),
  state: z.string(),
  lga: z.string(),
  ward: z.string(),
  name: z.string(),
  synthetic: z.boolean(),
});
export type PollingUnit = z.infer<typeof PollingUnit>;

/**
 * Metadata for an evidence upload. `sourceType` is the capturer's own claim about their role
 * (voter/witness vs accredited observer/agent); it is never treated as verified identity.
 * Optional with WITNESS_PHOTO default so captures queued before this field existed still sync.
 */
export const EvidenceUploadMeta = z.object({
  electionId: z.string().min(1),
  pollingUnitId: z.string().min(1),
  clientSubmissionId: z.uuid(),
  originalSha256: Sha256Hex,
  capturedAtClaimed: z.iso.datetime().optional(),
  sourceType: EvidenceSource.default("WITNESS_PHOTO"),
});
export type EvidenceUploadMeta = z.infer<typeof EvidenceUploadMeta>;

/**
 * Direct-to-storage upload, step 1: POST /api/evidence/uploads (JSON).
 * The server checks auth, metadata and idempotency, then issues a short-lived signed upload
 * target for a staging key only it can promote. Original bytes never pass through the app server
 * on the way in (avoids the serverless request-body limit).
 */
export const UploadInitRequest = EvidenceUploadMeta.extend({
  sizeBytes: z.number().int().positive(),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
export type UploadInitRequest = z.infer<typeof UploadInitRequest>;

/** Either an upload target, or the existing receipt when this submission was already received. */
export const UploadInitResponse = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("UPLOAD_REQUIRED"),
    /** Absolute or same-origin URL; client PUTs the raw original bytes to it. */
    uploadUrl: z.string().min(1),
    /** Extra headers the client must send with the PUT (e.g. content-type). */
    uploadHeaders: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    state: z.literal("ALREADY_RECEIVED"),
    receipt: z.lazy(() => EvidenceReceipt),
  }),
]);
export type UploadInitResponse = z.infer<typeof UploadInitResponse>;

/** Step 3: POST /api/evidence/uploads/finalize — server re-hashes the staged object. */
export const UploadFinalizeRequest = z.object({ clientSubmissionId: z.uuid() });
export type UploadFinalizeRequest = z.infer<typeof UploadFinalizeRequest>;

export const EvidenceReceipt = z.object({
  id: z.string(),
  sha256: Sha256Hex,
  receivedAt: z.iso.datetime(),
  status: EvidenceStatus,
});
export type EvidenceReceipt = z.infer<typeof EvidenceReceipt>;

export const ReviewRequest = z.object({
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  independenceStatus: Independence,
  reason: z.string().min(3).max(2000),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const ReferenceRequest = z.object({
  electionId: z.string(),
  pollingUnitId: z.string(),
  sourceType: ReferenceType,
  sourceDescription: z.string().min(3),
  sourceUrl: z.url().optional(),
  figures: z.record(z.string(), z.number().int().min(0)),
  synthetic: z.boolean(),
});
export type ReferenceRequest = z.infer<typeof ReferenceRequest>;

/** Accepted image types for original evidence. Checked by magic bytes on the server. */
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
