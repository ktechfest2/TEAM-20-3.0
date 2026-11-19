"use client";
/**
 * Retry-safe upload of locally saved originals. The clientSubmissionId (capture.id) is the
 * idempotency key and is never regenerated, so repeating an upload cannot create a second record.
 * A capture becomes RECEIVED only when the server returns a receipt whose sha256 equals ours.
 */
import { EvidenceReceipt } from "@/lib/contracts";
import { getDB, type LocalCapture, type PollTraceDB } from "./db";

export type AttentionReason =
  | "NETWORK"
  | "HASH_MISMATCH"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "UNREADABLE"
  | "REJECTED_FILE";

export const MAX_AUTO_ATTEMPTS = 3;

const inFlight = new Set<string>();

async function ensureSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/session", { method: "POST", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

async function post(c: LocalCapture): Promise<Response> {
  const form = new FormData();
  form.set("file", c.blob, c.fileName || "original");
  form.set("electionId", c.electionId);
  form.set("pollingUnitId", c.pollingUnitId);
  form.set("clientSubmissionId", c.id);
  form.set("originalSha256", c.sha256);
  form.set("capturedAtClaimed", c.capturedAt);
  form.set("sourceType", c.sourceType ?? "WITNESS_PHOTO");
  return fetch("/api/evidence", { method: "POST", body: form, credentials: "same-origin" });
}

/** On app start: an UPLOADING row means the tab died mid-upload. Retrying is safe. */
export async function recoverInterruptedUploads(db: PollTraceDB = getDB()): Promise<void> {
  await db.captures.where("status").equals("UPLOADING").modify({ status: "SAVED_LOCAL" });
}

export async function uploadCapture(id: string, db: PollTraceDB = getDB()): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const c = await db.captures.get(id);
    if (!c || c.status === "RECEIVED") return;
    const attempts = c.attempts + 1;
    await db.captures.update(id, { status: "UPLOADING", attempts });

    const fail = (reason: AttentionReason) =>
      db.captures.update(id, { status: "NEEDS_ATTENTION", lastError: reason });
    const transient = () =>
      attempts >= MAX_AUTO_ATTEMPTS
        ? fail("NETWORK")
        : db.captures.update(id, { status: "SAVED_LOCAL", lastError: "NETWORK" });

    // Make sure the original bytes are still readable before sending.
    try {
      await c.blob.slice(0, 1).arrayBuffer();
    } catch {
      await fail("UNREADABLE");
      return;
    }

    let res: Response;
    try {
      res = await post(c);
      if (res.status === 401 && (await ensureSession())) res = await post(c);
    } catch {
      await transient();
      return;
    }

    if (res.ok) {
      const parsed = EvidenceReceipt.safeParse(await res.json().catch(() => null));
      if (!parsed.success) {
        await transient();
        return;
      }
      if (parsed.data.sha256 !== c.sha256) {
        await fail("HASH_MISMATCH");
        return;
      }
      await db.captures.update(id, { status: "RECEIVED", lastError: null, serverReceipt: parsed.data });
      return;
    }
    if (res.status === 401 || res.status === 403) await fail("UNAUTHORIZED");
    else if (res.status === 409) await fail("CONFLICT");
    else if (res.status === 422) await fail("HASH_MISMATCH");
    else if (res.status === 400 || res.status === 413 || res.status === 415) await fail("REJECTED_FILE");
    else await transient();
  } finally {
    inFlight.delete(id);
  }
}

/** Upload everything pending. `includeAttention` = a person pressed "Upload all now". */
export async function syncAll(includeAttention = false, db: PollTraceDB = getDB()): Promise<void> {
  const states = includeAttention ? ["SAVED_LOCAL", "NEEDS_ATTENTION"] : ["SAVED_LOCAL"];
  const pending = await db.captures.where("status").anyOf(states).sortBy("capturedAt");
  for (const c of pending) await uploadCapture(c.id, db);
}

export const ATTENTION_COPY: Record<AttentionReason, string> = {
  NETWORK: `Upload did not finish after ${MAX_AUTO_ATTEMPTS} tries. Your photo is still saved on this device.`,
  HASH_MISMATCH: "The server's fingerprint did not match. Your original is still on this device.",
  UNAUTHORIZED: "The server did not accept this upload. Your photo is still saved on this device.",
  CONFLICT: "This receipt number was already used for a different photo. Your photo is still saved on this device.",
  UNREADABLE: "This photo can no longer be read on this device. It has not been deleted.",
  REJECTED_FILE: "The server could not accept this file. Only JPG, PNG or WebP photos up to 15 MB can be sent.",
};
