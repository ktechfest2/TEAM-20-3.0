/**
 * Direct-to-storage upload (3 steps) so 15 MB originals bypass the serverless body limit.
 *
 *  1. initUpload      POST /api/evidence/uploads           -> signed staging target + intentToken
 *  2. client PUT      raw bytes to the staging target       (Supabase signed URL, or LOCAL_DEV route)
 *  3. finalizeUpload  POST /api/evidence/uploads/finalize   {clientSubmissionId, intentToken}
 *
 * No pending-upload table: the intent (contributor, submission, claimed hash, metadata, expiry)
 * lives in a server-signed token the client echoes back. The client can read but not alter it.
 * Staging bytes are NEVER trusted: finalize downloads them, verifies them, and writes the SAME
 * in-memory buffer to the write-once original key (no storage move/copy, which could promote
 * bytes re-uploaded to the still-valid staging URL after the check).
 */
import { MAX_ORIGINAL_BYTES, UploadFinalizeRequest, UploadInitRequest, type EvidenceUploadMeta } from "@/lib/contracts";
import type { Principal } from "@/lib/auth/session";
import { signToken, verifyToken } from "@/lib/auth/tokens";
import { STAGING_PREFIX } from "@/lib/storage";
import {
  checkRegistry,
  commitVerifiedEvidence,
  fail,
  fileTooLarge,
  invalid,
  rateLimited,
  receiptOf,
  reviewerSession,
  replayOrConflict,
  type ServiceResult,
  type SubmitDeps,
} from "./service";

/** Upload window reported to the client. A 15 MB PUT at ~25 KB/s (poor 2G/EDGE) is ~10 min. */
export const UPLOAD_WINDOW_MS = 15 * 60_000;
/** Finalize accepted this long after the upload window, for a PUT that started just in time. */
export const FINALIZE_GRACE_MS = 5 * 60_000;

/**
 * `intentToken` is now part of the shared contract (lead-approved 2026-11-19); kept as an alias.
 */
export const UploadFinalizeRequestExt = UploadFinalizeRequest;

export interface UploadIntent {
  exp: number; // unix seconds; finalize deadline (upload window + grace)
  cid: string; // contributor id
  csid: string; // clientSubmissionId
  sha: string; // claimed sha256
  size: number; // declared size
  mime: string; // declared mime (informational; detection is by signature)
  eid: string;
  puid: string;
  src: EvidenceUploadMeta["sourceType"];
  cap: string | null;
  key: string; // staging key
}

export interface LocalPutGrant {
  exp: number;
  key: string;
  mime: string;
}

export const stagingKeyFor = (contributorId: string, clientSubmissionId: string) =>
  `${STAGING_PREFIX}${contributorId}/${clientSubmissionId}`;

export const LOCAL_PUT_ROUTE = "/api/evidence/uploads/local/";

const nowOf = (deps: SubmitDeps) => (deps.now ?? (() => new Date()))();

export async function initUpload(p: Principal | null, body: unknown, deps: SubmitDeps): Promise<ServiceResult> {
  if (!p) return fail(401, "UNAUTHENTICATED", "A session is required. Call POST /api/session first.");
  if (p.role === "REVIEWER") return reviewerSession();
  const limited = rateLimited(deps.rateLimiter, `upload-init:${p.contributorId}`);
  if (limited) return limited;

  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const parsed = UploadInitRequest.safeParse({
    ...raw,
    originalSha256: typeof raw.originalSha256 === "string" ? raw.originalSha256.toLowerCase() : raw.originalSha256,
  });
  if (!parsed.success) return invalid("INVALID_METADATA", "Upload metadata failed validation.", parsed.error);
  const req = parsed.data;

  const registryError = checkRegistry(req.electionId, req.pollingUnitId);
  if (registryError) return registryError;
  if (req.sizeBytes > MAX_ORIGINAL_BYTES) return fileTooLarge();

  const { storage } = deps;
  const existing = await storage.repo.findEvidenceBySubmission(p.contributorId, req.clientSubmissionId);
  if (existing) {
    const r = replayOrConflict(existing, req.originalSha256, storage.mode);
    if (r.status !== 200) return r;
    return { status: 200, body: { state: "ALREADY_RECEIVED", receipt: receiptOf(existing, storage.mode) }, headers: r.headers };
  }

  const issuedMs = nowOf(deps).getTime();
  const uploadDeadline = issuedMs + UPLOAD_WINDOW_MS;
  const key = stagingKeyFor(p.contributorId, req.clientSubmissionId);

  let target = await storage.objects.createStagingUploadTarget(key, req.mime);
  if (!target) {
    const grant = signToken<LocalPutGrant>("lp1", { exp: Math.floor(uploadDeadline / 1000), key, mime: req.mime });
    target = { url: `${LOCAL_PUT_ROUTE}${grant}`, headers: { "content-type": req.mime } };
  }

  const intentToken = signToken<UploadIntent>("pi1", {
    exp: Math.floor((uploadDeadline + FINALIZE_GRACE_MS) / 1000),
    cid: p.contributorId,
    csid: req.clientSubmissionId,
    sha: req.originalSha256,
    size: req.sizeBytes,
    mime: req.mime,
    eid: req.electionId,
    puid: req.pollingUnitId,
    src: req.sourceType,
    cap: req.capturedAtClaimed ?? null,
    key,
  });

  return {
    status: 200,
    body: {
      state: "UPLOAD_REQUIRED",
      uploadUrl: target.url,
      uploadHeaders: target.headers,
      expiresAt: new Date(uploadDeadline).toISOString(),
      intentToken,
      storageMode: storage.mode,
    },
  };
}

async function discardStaging(deps: SubmitDeps, key: string) {
  try {
    await deps.storage.objects.removeStaging(key);
  } catch (err) {
    console.warn("[polltrace] staging cleanup failed (object stays private, unpromoted)", err);
  }
}

export async function finalizeUpload(p: Principal | null, body: unknown, deps: SubmitDeps): Promise<ServiceResult> {
  if (!p) return fail(401, "UNAUTHENTICATED", "A session is required. Call POST /api/session first.");
  if (p.role === "REVIEWER") return reviewerSession();
  const limited = rateLimited(deps.rateLimiter, `upload-finalize:${p.contributorId}`);
  if (limited) return limited;

  const parsed = UploadFinalizeRequest.safeParse(body);
  if (!parsed.success) return invalid("INVALID_REQUEST", "Expected { clientSubmissionId, intentToken }.", parsed.error);

  const notFound = fail(404, "UPLOAD_INTENT_NOT_FOUND", "No upload was started for this submission. Call POST /api/evidence/uploads.");
  const v = verifyToken<UploadIntent>("pi1", parsed.data.intentToken, nowOf(deps).getTime());
  const intent = v.ok ? v.payload : v.reason === "EXPIRED" ? v.payload : undefined;
  // Wrong owner / wrong submission looks identical to "never started" (no probing).
  if (!intent || intent.cid !== p.contributorId || intent.csid !== parsed.data.clientSubmissionId) return notFound;

  const { storage } = deps;
  // Idempotency BEFORE expiry: a lost 201 can be replayed any time later.
  const existing = await storage.repo.findEvidenceBySubmission(p.contributorId, intent.csid);
  if (existing) {
    const r = replayOrConflict(existing, intent.sha, storage.mode);
    if (r.status === 409) await discardStaging(deps, intent.key);
    return r;
  }

  if (!v.ok) {
    await discardStaging(deps, intent.key);
    return fail(410, "UPLOAD_INTENT_EXPIRED", "The upload window expired. Start again with POST /api/evidence/uploads.");
  }

  const bytes = await storage.objects.get(intent.key);
  if (!bytes) {
    // A concurrent finalize may have just promoted and removed the staged object.
    const raced = await storage.repo.findEvidenceBySubmission(p.contributorId, intent.csid);
    if (raced) return replayOrConflict(raced, intent.sha, storage.mode);
    return fail(409, "UPLOAD_INCOMPLETE", "No staged bytes found. PUT the original to uploadUrl, then finalize.");
  }

  const meta: EvidenceUploadMeta = {
    electionId: intent.eid,
    pollingUnitId: intent.puid,
    clientSubmissionId: intent.csid,
    originalSha256: intent.sha,
    capturedAtClaimed: intent.cap ?? undefined,
    sourceType: intent.src,
  };
  const result =
    bytes.byteLength > MAX_ORIGINAL_BYTES
      ? fileTooLarge()
      : await commitVerifiedEvidence(p, meta, bytes, deps, "DIRECT_STAGED", {
          declaredMime: intent.mime,
          declaredSizeBytes: intent.size,
        });

  // Terminal outcome (stored, replayed, or rejected): staged bytes are no longer needed.
  // On 5xx keep them so a retry of finalize can succeed without re-uploading.
  if (result.status < 500) await discardStaging(deps, intent.key);
  return result;
}

/** LOCAL_DEV only: receives the raw PUT for a signed staging grant. */
export async function stageLocalUpload(
  grantToken: string,
  declaredLength: number | null,
  readBody: (maxBytes: number) => Promise<Uint8Array | null>,
  deps: SubmitDeps,
): Promise<ServiceResult> {
  if (deps.storage.mode !== "LOCAL_DEV") return fail(404, "NOT_FOUND", "Not found.");
  const v = verifyToken<LocalPutGrant>("lp1", grantToken, nowOf(deps).getTime());
  if (!v.ok) {
    return v.reason === "EXPIRED"
      ? fail(410, "UPLOAD_GRANT_EXPIRED", "Upload URL expired. Start again with POST /api/evidence/uploads.")
      : fail(403, "INVALID_UPLOAD_GRANT", "Invalid upload URL.");
  }
  if (declaredLength !== null && declaredLength > MAX_ORIGINAL_BYTES) return fileTooLarge();
  const bytes = await readBody(MAX_ORIGINAL_BYTES);
  if (bytes === null) return fileTooLarge();
  if (bytes.byteLength === 0) return fail(400, "MISSING_FILE", "Empty body.");
  await deps.storage.objects.putStaging(v.payload.key, bytes, v.payload.mime);
  return { status: 200, body: { staged: true, sizeBytes: bytes.byteLength } };
}
