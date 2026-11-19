/**
 * Evidence submission service. Framework-free: route handlers parse HTTP, this
 * decides. Order of checks is deliberate (cheap + no side effects first):
 * auth -> rate limit -> meta -> election/PU -> file -> size -> signature -> hash
 * -> idempotency -> write-once object -> row (unique) -> audit.
 */
import { createHash, randomUUID } from "node:crypto";
import { EvidenceReceipt, EvidenceUploadMeta, MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import { findElection, findPollingUnit } from "@/lib/seed/registry";
import type { Principal } from "@/lib/auth/session";
import type { EvidenceRecord, EvidenceStorage, StorageMode } from "@/lib/storage";
import type { RateLimiter } from "./rate-limit";
import { detectImageMime, extensionFor } from "./signature";

export interface ServiceResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface SubmitDeps {
  storage: EvidenceStorage;
  rateLimiter: RateLimiter;
  now?: () => Date;
  newId?: () => string;
}

export interface SubmitInput {
  principal: Principal | null;
  /** Raw string fields from multipart form data. */
  fields: Record<string, string | undefined>;
  /** Original bytes exactly as received. null if no file part. */
  file: Uint8Array | null;
}

export type SubmitReceipt = EvidenceReceipt & { storageMode: StorageMode; synthetic: boolean };

export const AUDIT_EVIDENCE_RECEIVED = "EVIDENCE_RECEIVED";

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, ...extra } };
}
const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>): ServiceResult => ({
  status,
  body: errorBody(code, message, extra),
});

export const sha256HexNode = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function receiptOf(e: EvidenceRecord, mode: StorageMode): SubmitReceipt {
  const base = EvidenceReceipt.parse({ id: e.id, sha256: e.sha256, receivedAt: e.receivedAt, status: e.status });
  return { ...base, storageMode: mode, synthetic: e.synthetic };
}

/** Same id + same bytes => same receipt; same id + other bytes => 409. */
function replayOrConflict(existing: EvidenceRecord, sha256: string, mode: StorageMode): ServiceResult {
  if (existing.sha256 === sha256) {
    return { status: 200, body: receiptOf(existing, mode), headers: { "Idempotent-Replay": "true" } };
  }
  return fail(
    409,
    "CLIENT_SUBMISSION_CONFLICT",
    "This clientSubmissionId was already used for different image bytes. Generate a new clientSubmissionId for a new photo.",
    { evidenceId: existing.id, existingSha256: existing.sha256, receivedSha256: sha256 },
  );
}

export async function submitEvidence(input: SubmitInput, deps: SubmitDeps): Promise<ServiceResult> {
  const { storage, rateLimiter } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;

  const p = input.principal;
  if (!p) return fail(401, "UNAUTHENTICATED", "A session is required. Call POST /api/session first.");

  const retryAfter = rateLimiter.hit(`upload:${p.contributorId}`);
  if (retryAfter > 0) {
    return { ...fail(429, "RATE_LIMITED", "Too many uploads; retry later."), headers: { "Retry-After": String(retryAfter) } };
  }

  const parsed = EvidenceUploadMeta.safeParse({
    electionId: input.fields.electionId,
    pollingUnitId: input.fields.pollingUnitId,
    clientSubmissionId: input.fields.clientSubmissionId,
    originalSha256: input.fields.originalSha256?.toLowerCase(),
    capturedAtClaimed: input.fields.capturedAtClaimed || undefined,
  });
  if (!parsed.success) {
    return fail(400, "INVALID_METADATA", "Upload metadata failed validation.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const meta = parsed.data;

  const election = findElection(meta.electionId);
  if (!election) return fail(400, "UNKNOWN_ELECTION", "Unknown electionId.");
  const unit = findPollingUnit(meta.pollingUnitId);
  if (!unit) return fail(400, "UNKNOWN_POLLING_UNIT", "Unknown pollingUnitId.");

  const bytes = input.file;
  if (!bytes || bytes.byteLength === 0) return fail(400, "MISSING_FILE", "A non-empty 'file' part is required.");
  if (bytes.byteLength > MAX_ORIGINAL_BYTES) {
    return fail(413, "FILE_TOO_LARGE", `Original exceeds ${MAX_ORIGINAL_BYTES} bytes.`, { maxBytes: MAX_ORIGINAL_BYTES });
  }

  const mime = detectImageMime(bytes);
  if (!mime) {
    return fail(400, "UNSUPPORTED_FILE_SIGNATURE", "File content is not a JPEG, PNG or WebP image (checked by file signature).");
  }

  const serverSha256 = sha256HexNode(bytes);
  if (serverSha256 !== meta.originalSha256) {
    return fail(422, "HASH_MISMATCH", "Server SHA-256 of the received bytes does not match the client hash. Nothing was stored.", {
      clientSha256: meta.originalSha256,
      serverSha256,
    });
  }

  const prior = await storage.repo.findEvidenceBySubmission(p.contributorId, meta.clientSubmissionId);
  if (prior) return replayOrConflict(prior, serverSha256, storage.mode);

  // Key contains the hash, so a key can only ever hold these exact bytes.
  const originalPath = `originals/${p.contributorId}/${meta.clientSubmissionId}/${serverSha256}.${extensionFor(mime)}`;
  await storage.objects.putImmutable(originalPath, bytes, mime, serverSha256);

  const record: EvidenceRecord = {
    id: newId(),
    clientSubmissionId: meta.clientSubmissionId,
    contributorId: p.contributorId,
    electionId: election.id,
    pollingUnitId: unit.id,
    sourceType: "WITNESS_PHOTO",
    originalPath,
    sha256: serverSha256,
    mime,
    sizeBytes: bytes.byteLength,
    capturedAtClaimed: meta.capturedAtClaimed ?? null,
    receivedAt: now().toISOString(),
    status: "RECEIVED",
    synthetic: election.synthetic || unit.synthetic,
  };

  const inserted = await storage.repo.insertEvidence(record);
  // Lost a race with a concurrent identical/conflicting request: same rules as a retry.
  if (!inserted.inserted) return replayOrConflict(inserted.existing, serverSha256, storage.mode);

  await storage.repo.appendAudit({
    id: newId(),
    evidenceId: record.id,
    actorId: p.contributorId,
    eventType: AUDIT_EVIDENCE_RECEIVED,
    metadata: {
      sha256: serverSha256,
      clientSha256Matched: true,
      mime,
      sizeBytes: record.sizeBytes,
      capturedAtClaimed: record.capturedAtClaimed,
      storageMode: storage.mode,
      synthetic: record.synthetic,
    },
    createdAt: record.receivedAt,
  });

  return { status: 201, body: receiptOf(record, storage.mode) };
}
