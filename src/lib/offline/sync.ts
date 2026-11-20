"use client";
/**
 * Retry-safe upload of locally saved originals, direct to storage:
 *   1. POST /api/evidence/uploads           → signed upload target + intentToken (or existing receipt)
 *   2. PUT  <uploadUrl>                      → raw original bytes straight to private staging
 *   3. POST /api/evidence/uploads/finalize   → server re-hashes the staged bytes, records evidence
 * The clientSubmissionId (capture.id) is the idempotency key and is never regenerated, so
 * repeating any step cannot create a second record. A capture becomes RECEIVED only when the
 * server returns a receipt whose sha256 equals ours.
 */
import { EvidenceReceipt, UploadInitResponse } from "@/lib/contracts";
import { captureBlob, getDB, type LocalCapture, type PollTraceDB } from "./db";

export type AttentionReason =
  | "NETWORK"
  | "HASH_MISMATCH"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "UNREADABLE"
  | "REJECTED_FILE";

export const MAX_AUTO_ATTEMPTS = 3;
const UPLOAD_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type Outcome =
  | { kind: "received"; receipt: EvidenceReceipt }
  | { kind: "attention"; reason: AttentionReason }
  | { kind: "transient" }
  /** This browser holds a reviewer session; reviewers cannot upload. Not a fault of the capture. */
  | { kind: "reviewer_session" };

/** Thrown out of uploadCapture's caller loop so syncAll stops trying further captures. */
const REVIEWER_SESSION = "REVIEWER_SESSION";

const inFlight = new Set<string>();

async function ensureSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/session", { method: "POST", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

/** JSON POST to our API; on 401 obtain a session once and retry. Throws on network failure. */
async function apiPost(path: string, body: unknown): Promise<Response> {
  const send = () =>
    fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  let res = await send();
  if (res.status === 401 && (await ensureSession())) res = await send();
  return res;
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code;
}

function classify(status: number): Outcome {
  if (status === 401 || status === 403) return { kind: "attention", reason: "UNAUTHORIZED" };
  if (status === 422) return { kind: "attention", reason: "HASH_MISMATCH" };
  if (status === 400 || status === 413 || status === 415) return { kind: "attention", reason: "REJECTED_FILE" };
  return { kind: "transient" }; // 404/410/429/5xx etc: start again from init next time
}

function toReceipt(json: unknown, c: LocalCapture): Outcome {
  const parsed = EvidenceReceipt.safeParse(json);
  if (!parsed.success) return { kind: "transient" };
  if (parsed.data.sha256 !== c.sha256) return { kind: "attention", reason: "HASH_MISMATCH" };
  return { kind: "received", receipt: parsed.data };
}

async function directUpload(c: LocalCapture): Promise<Outcome> {
  if (!UPLOAD_MIME.has(c.mime)) return { kind: "attention", reason: "REJECTED_FILE" };

  // 1. init
  const init = await apiPost("/api/evidence/uploads", {
    electionId: c.electionId,
    pollingUnitId: c.pollingUnitId,
    clientSubmissionId: c.id,
    originalSha256: c.sha256,
    sizeBytes: c.sizeBytes,
    mime: c.mime,
    sourceType: c.sourceType ?? "WITNESS_PHOTO",
    capturedAtClaimed: c.capturedAt,
  });
  if (init.status === 409) return { kind: "attention", reason: "CONFLICT" };
  if (init.status === 403 && (await errorCode(init)) === REVIEWER_SESSION) return { kind: "reviewer_session" };
  if (!init.ok) return classify(init.status);
  const parsed = UploadInitResponse.safeParse(await init.json().catch(() => null));
  if (!parsed.success) return { kind: "transient" };
  if (parsed.data.state === "ALREADY_RECEIVED") return toReceipt(parsed.data.receipt, c);
  const target = parsed.data;

  // 2. PUT original bytes straight to staging. Send exactly the given headers, no cookies.
  const put = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.uploadHeaders,
    body: captureBlob(c),
    credentials: "omit",
  });
  if (put.status === 413) return { kind: "attention", reason: "REJECTED_FILE" };
  if (put.status === 403 && (await errorCode(put)) === REVIEWER_SESSION) return { kind: "reviewer_session" };
  if (!put.ok) return { kind: "transient" };

  // 3. finalize: server re-hashes the staged bytes.
  const fin = await apiPost("/api/evidence/uploads/finalize", {
    clientSubmissionId: c.id,
    intentToken: target.intentToken,
  });
  if (fin.ok) return toReceipt(await fin.json().catch(() => null), c);
  if (fin.status === 403 && (await errorCode(fin)) === REVIEWER_SESSION) return { kind: "reviewer_session" };
  if (fin.status === 409) {
    return (await errorCode(fin)) === "CLIENT_SUBMISSION_CONFLICT"
      ? { kind: "attention", reason: "CONFLICT" }
      : { kind: "transient" }; // UPLOAD_INCOMPLETE: PUT again next attempt
  }
  return classify(fin.status);
}

/** On app start: an UPLOADING row means the tab died mid-upload. Retrying is safe. */
export async function recoverInterruptedUploads(db: PollTraceDB = getDB()): Promise<void> {
  await db.captures.where("status").equals("UPLOADING").modify({ status: "SAVED_LOCAL" });
}

/**
 * Returns "reviewer_session" when the server refused because this browser is signed in as a
 * reviewer: the capture goes back to SAVED_LOCAL untouched (no error, no attempt counted
 * against it) and callers should stop syncing until a contributor session exists again.
 */
export async function uploadCapture(id: string, db: PollTraceDB = getDB()): Promise<void | "reviewer_session"> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const c = await db.captures.get(id);
    if (!c || c.status === "RECEIVED") return;
    const attempts = c.attempts + 1;
    await db.captures.update(id, { status: "UPLOADING", attempts });

    // Make sure the original bytes are still readable before sending.
    try {
      await captureBlob(c).slice(0, 1).arrayBuffer();
    } catch {
      await db.captures.update(id, { status: "NEEDS_ATTENTION", lastError: "UNREADABLE" });
      return;
    }

    let outcome: Outcome;
    try {
      outcome = await directUpload(c);
    } catch {
      outcome = { kind: "transient" }; // network dropped somewhere in the 3 steps
    }

    if (outcome.kind === "reviewer_session") {
      await db.captures.update(id, { status: "SAVED_LOCAL", attempts: c.attempts, lastError: null });
      return "reviewer_session";
    }
    if (outcome.kind === "received") {
      await db.captures.update(id, { status: "RECEIVED", lastError: null, serverReceipt: outcome.receipt });
    } else if (outcome.kind === "attention") {
      await db.captures.update(id, { status: "NEEDS_ATTENTION", lastError: outcome.reason });
    } else if (attempts >= MAX_AUTO_ATTEMPTS) {
      await db.captures.update(id, { status: "NEEDS_ATTENTION", lastError: "NETWORK" });
    } else {
      await db.captures.update(id, { status: "SAVED_LOCAL", lastError: "NETWORK" });
    }
  } finally {
    inFlight.delete(id);
  }
}

/** Upload everything pending. `includeAttention` = a person pressed "Upload all now". */
export async function syncAll(includeAttention = false, db: PollTraceDB = getDB()): Promise<void> {
  const states = includeAttention ? ["SAVED_LOCAL", "NEEDS_ATTENTION"] : ["SAVED_LOCAL"];
  const pending = await db.captures.where("status").anyOf(states).sortBy("capturedAt");
  for (const c of pending) {
    if ((await uploadCapture(c.id, db)) === "reviewer_session") return;
  }
}

export const ATTENTION_COPY: Record<AttentionReason, string> = {
  NETWORK: `Upload did not finish after ${MAX_AUTO_ATTEMPTS} tries. Your photo is still saved on this device.`,
  HASH_MISMATCH: "The server's fingerprint did not match. Your original is still on this device.",
  UNAUTHORIZED: "The server did not accept this upload. Your photo is still saved on this device.",
  CONFLICT: "This receipt number was already used for a different photo. Your photo is still saved on this device.",
  UNREADABLE: "This photo can no longer be read on this device. It has not been deleted.",
  REJECTED_FILE: "The server could not accept this file. Only JPG, PNG or WebP photos up to 15 MB can be sent.",
};
