/**
 * Persistent offline store (IndexedDB via Dexie).
 * A capture is "saved on this device" only after the original Blob, its SHA-256 and a stable
 * clientSubmissionId are committed and read back. Nothing here implies server receipt.
 */
import Dexie, { type EntityTable } from "dexie";
import type { EvidenceReceipt, EvidenceSource } from "@/lib/contracts";
import { sha256Hex } from "./hash";

export type CaptureStatus = "SAVED_LOCAL" | "UPLOADING" | "RECEIVED" | "NEEDS_ATTENTION";

export interface LocalCapture {
  /** clientSubmissionId: stable idempotency key, created once, never regenerated. */
  id: string;
  blob: Blob;
  sha256: string;
  mime: string;
  sizeBytes: number;
  fileName: string;
  electionId: string;
  pollingUnitId: string;
  /** Capturer's own claim about their role. Absent on captures saved before this existed. */
  sourceType?: EvidenceSource;
  /** When the device stored the photo (ISO, phone clock). A claim, not proof of time taken. */
  capturedAt: string;
  status: CaptureStatus;
  attempts: number;
  lastError: string | null;
  /** Present only after the server acknowledged the upload. */
  serverReceipt: EvidenceReceipt | null;
  synthetic: boolean;
}

export class PollTraceDB extends Dexie {
  captures!: EntityTable<LocalCapture, "id">;
  constructor(name = "polltrace") {
    super(name);
    this.version(1).stores({ captures: "id, status, capturedAt, sha256" });
  }
}

let _db: PollTraceDB | null = null;
export function getDB(): PollTraceDB {
  if (!_db) _db = new PollTraceDB();
  return _db;
}

export class StorageFullError extends Error {
  constructor() {
    super("This phone has no space left to save the photo.");
    this.name = "StorageFullError";
  }
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === "QuotaExceededError" || err?.inner?.name === "QuotaExceededError";
}

export interface SaveCaptureInput {
  blob: Blob;
  fileName: string;
  electionId: string;
  pollingUnitId: string;
  sourceType: EvidenceSource;
  synthetic: boolean;
}

/** Hash, then persist original bytes + id + hash. Returns the stored record after read-back. */
export async function saveCapture(input: SaveCaptureInput, db: PollTraceDB = getDB()): Promise<LocalCapture> {
  const sha256 = await sha256Hex(input.blob);
  const record: LocalCapture = {
    id: crypto.randomUUID(),
    blob: input.blob,
    sha256,
    mime: input.blob.type || "application/octet-stream",
    sizeBytes: input.blob.size,
    fileName: input.fileName,
    electionId: input.electionId,
    pollingUnitId: input.pollingUnitId,
    sourceType: input.sourceType,
    capturedAt: new Date().toISOString(),
    status: "SAVED_LOCAL",
    attempts: 0,
    lastError: null,
    serverReceipt: null,
    synthetic: input.synthetic,
  };
  try {
    await db.captures.add(record);
  } catch (e) {
    if (isQuotaError(e)) throw new StorageFullError();
    throw e;
  }
  const stored = await db.captures.get(record.id);
  if (!stored || stored.sha256 !== sha256 || stored.blob.size !== input.blob.size) {
    throw new Error("The photo could not be saved on this device.");
  }
  return stored;
}

export async function listCaptures(db: PollTraceDB = getDB()): Promise<LocalCapture[]> {
  return db.captures.orderBy("capturedAt").reverse().toArray();
}

export async function getCapture(id: string, db: PollTraceDB = getDB()): Promise<LocalCapture | undefined> {
  return db.captures.get(id);
}

/** Ask the browser not to evict our store under pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* unsupported */
  }
  return false;
}
