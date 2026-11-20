/**
 * Server-side persistence interfaces for evidence. Two adapters implement them:
 *  - LOCAL_DEV: JSON + files under /.data (development only, clearly labelled)
 *  - SUPABASE:  Postgres tables from supabase/migrations/0001_init.sql + private bucket
 *
 * Records mirror the SQL columns (camelCase). These are internal server types;
 * public/API shapes live in src/lib/contracts and src/lib/evidence/redact.ts.
 */
import type {
  EvidenceSource,
  EvidenceStatus,
  ExtractionMode,
  FormType,
  Independence,
  ResultField,
  ReferenceType,
  ReviewDecision,
} from "@/lib/contracts";
import type { RevisionOrigin } from "@/lib/contracts/trace";

export type StorageMode = "LOCAL_DEV" | "SUPABASE";
export type ContributorRole = "CONTRIBUTOR" | "REVIEWER";

export interface ContributorRecord {
  id: string; // uuid
  alias: string;
  role: ContributorRole;
  assurance: string; // 'UNVERIFIED' for anonymous sessions
  synthetic: boolean;
  createdAt: string;
}

export interface EvidenceRecord {
  id: string; // uuid
  clientSubmissionId: string; // uuid
  contributorId: string;
  electionId: string;
  pollingUnitId: string;
  sourceType: EvidenceSource;
  originalPath: string; // private object key; NEVER returned to clients
  sha256: string;
  mime: string;
  sizeBytes: number;
  capturedAtClaimed: string | null; // device claim, not proof
  receivedAt: string;
  status: EvidenceStatus;
  synthetic: boolean;
}

export interface AuditEventRecord {
  id: string;
  evidenceId: string | null;
  actorId: string | null;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** One immutable result revision (result_revisions row + its result_entries). */
export interface RevisionRecord {
  id: string;
  evidenceId: string;
  revisionNumber: number;
  origin: RevisionOrigin;
  extractionMode: ExtractionMode | null;
  formType: FormType;
  pollingUnitCodeOnSheet: string | null;
  entries: ResultField[];
  accreditedVoters: number | null;
  rejectedVotes: number | null;
  validVotes: number | null;
  warnings: string[];
  /** Untrusted machine output, or the human's submitted payload, kept verbatim. */
  rawExtraction: unknown;
  humanConfirmed: boolean;
  basedOnRevision: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ReviewEventRecord {
  id: string;
  evidenceId: string;
  reviewerId: string;
  decision: ReviewDecision;
  independenceStatus: Independence;
  reason: string;
  createdAt: string;
}

/** Immutable reference record (reference_results). source_verified column stays false; derived. */
export interface ReferenceRecord {
  id: string;
  electionId: string;
  pollingUnitId: string;
  sourceType: ReferenceType;
  sourceDescription: string;
  /** Stored as text only. NEVER fetched by the server (no SSRF surface). */
  sourceUrl: string | null;
  version: number;
  figures: Record<string, number>;
  synthetic: boolean;
  createdBy: string | null;
  createdAt: string;
}

export type ReferenceReviewDecision = "SOURCE_CONFIRMED" | "SOURCE_REJECTED";

export interface ReferenceReviewRecord {
  id: string;
  referenceId: string;
  reviewerId: string;
  decision: ReferenceReviewDecision;
  reason: string;
  createdAt: string;
}

/** Counts returned by the scoped demo reset (+ original object keys to remove afterwards). */
export interface DemoResetResult {
  evidence: number;
  revisions: number;
  entries: number;
  reviews: number;
  audit: number;
  references: number;
  referenceReviews: number;
  originalPaths: string[];
}

export type InsertRevisionResult =
  | { inserted: true; record: RevisionRecord }
  /** unique(evidence_id, revision_number) taken: someone else wrote that number first. */
  | { inserted: false };

export type InsertEvidenceResult =
  | { inserted: true; record: EvidenceRecord }
  /** unique(contributor_id, client_submission_id) already taken; existing row returned. */
  | { inserted: false; existing: EvidenceRecord };

export interface EvidenceRepository {
  getContributor(id: string): Promise<ContributorRecord | null>;
  /** Insert if absent (idempotent by id). Returns the stored record. */
  ensureContributor(record: ContributorRecord): Promise<ContributorRecord>;
  findEvidenceBySubmission(contributorId: string, clientSubmissionId: string): Promise<EvidenceRecord | null>;
  getEvidence(id: string): Promise<EvidenceRecord | null>;
  /** Must be atomic w.r.t. unique(contributorId, clientSubmissionId). */
  insertEvidence(record: EvidenceRecord): Promise<InsertEvidenceResult>;
  /** Append-only. There is intentionally no update/delete. */
  appendAudit(event: AuditEventRecord): Promise<void>;
  listAudit(evidenceId: string): Promise<AuditEventRecord[]>;

  /** Status is the ONLY mutable evidence column (DB trigger guards original fields). */
  updateEvidenceStatus(id: string, status: EvidenceStatus): Promise<void>;
  /** Evidence awaiting a decision, oldest received first. */
  listEvidenceByStatus(statuses: EvidenceStatus[], limit: number): Promise<EvidenceRecord[]>;
  /** Number of evidence rows per sha256 (including the row itself). */
  countEvidenceBySha(shas: string[]): Promise<Record<string, number>>;

  /** Append-only; ordered by revisionNumber ascending. */
  listRevisions(evidenceIds: string[]): Promise<RevisionRecord[]>;
  /** Never overwrites: returns {inserted:false} if that revision number already exists. */
  insertRevision(record: RevisionRecord): Promise<InsertRevisionResult>;

  /** Append-only; ordered by createdAt ascending. */
  listReviews(evidenceIds: string[]): Promise<ReviewEventRecord[]>;
  insertReview(record: ReviewEventRecord): Promise<void>;

  /** All evidence for one election + polling unit (any status). */
  listEvidenceForUnit(electionId: string, pollingUnitId: string): Promise<EvidenceRecord[]>;

  /** Never overwrites: {inserted:false} if that (election, unit, version) exists. */
  insertReference(record: ReferenceRecord): Promise<{ inserted: boolean }>;
  getReference(id: string): Promise<ReferenceRecord | null>;
  /** Ordered by version ascending. */
  listReferences(electionId: string, pollingUnitId: string): Promise<ReferenceRecord[]>;
  /** Append-only. */
  insertReferenceReview(record: ReferenceReviewRecord): Promise<void>;
  /** Ordered by createdAt ascending. */
  listReferenceReviews(referenceIds: string[]): Promise<ReferenceReviewRecord[]>;

  /**
   * DEMO ONLY. Deletes exactly: evidence on `unitId` by `witnessIds` (+ revisions, entries,
   * reviews, audit rows) and SYNTHETIC_DEMO references on `unitId` created by `reviewerIds`
   * (+ reference reviews and REFERENCE_* audit rows). Refuses non-synthetic units/actors/rows.
   */
  resetDemoScenario(unitId: string, witnessIds: string[], reviewerIds: string[]): Promise<DemoResetResult>;
}

export type PutResult = "CREATED" | "ALREADY_PRESENT_IDENTICAL";

export interface ObjectStore {
  /**
   * Write-once. Never overwrites. If the key exists with identical bytes the call
   * succeeds with ALREADY_PRESENT_IDENTICAL (safe retry); different bytes throw.
   */
  putImmutable(key: string, bytes: Uint8Array, mime: string, sha256: string): Promise<PutResult>;
  get(key: string): Promise<Uint8Array | null>;

  /**
   * STAGING ONLY (keys must start with "staging/"). Overwrite allowed: staged bytes are
   * untrusted until finalize re-hashes them. Originals can never be written or removed here.
   */
  putStaging(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Removes a staging object. Refuses any key outside "staging/". Missing key is not an error. */
  removeStaging(key: string): Promise<void>;
  /**
   * Remote adapters return a direct signed upload target for a staging key (upsert allowed).
   * LOCAL_DEV returns null: the service issues a same-origin signed PUT route instead.
   */
  createStagingUploadTarget(key: string, mime: string): Promise<{ url: string; headers: Record<string, string> } | null>;
  /**
   * DEMO RESET ONLY. Removes original objects, and only keys of the exact form
   * "originals/<allowedContributorId>/..." (throws otherwise, before removing anything).
   */
  removeDemoOriginals(keys: string[], allowedContributorIds: string[]): Promise<void>;
}

export function assertDemoOriginalKeys(keys: string[], allowedContributorIds: string[]): void {
  for (const key of keys) {
    const m = /^originals\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(jpg|png|webp)$/.exec(key);
    if (!m || !allowedContributorIds.includes(m[1])) throw new Error(`Refusing to remove non-demo original: ${key}`);
  }
}

export const STAGING_PREFIX = "staging/";
export function assertStagingKey(key: string): void {
  if (!key.startsWith(STAGING_PREFIX) || key.includes("..")) {
    throw new Error(`Refusing non-staging key: ${key}`);
  }
}

export interface EvidenceStorage {
  mode: StorageMode;
  repo: EvidenceRepository;
  objects: ObjectStore;
  /** LOCAL_DEV: resolves once the historical reference sample is seeded. Await before reading references. */
  ready?: Promise<unknown>;
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

export class ImmutableObjectConflictError extends Error {
  constructor(key: string) {
    super(`Refusing to overwrite immutable object: ${key}`);
    this.name = "ImmutableObjectConflictError";
  }
}
