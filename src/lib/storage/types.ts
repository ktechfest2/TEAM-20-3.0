/**
 * Server-side persistence interfaces for evidence. Two adapters implement them:
 *  - LOCAL_DEV: JSON + files under /.data (development only, clearly labelled)
 *  - SUPABASE:  Postgres tables from supabase/migrations/0001_init.sql + private bucket
 *
 * Records mirror the SQL columns (camelCase). These are internal server types;
 * public/API shapes live in src/lib/contracts and src/lib/evidence/redact.ts.
 */
import type { EvidenceSource, EvidenceStatus } from "@/lib/contracts";

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
