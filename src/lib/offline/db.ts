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
  /**
   * The original bytes. Stored as an ArrayBuffer, not a Blob/File: WebKit (iOS Safari) keeps a
   * File picked from the gallery only as a reference to a temporary file, which becomes unreadable
   * later ("This photo can no longer be read on this device"). An ArrayBuffer is copied in full.
   */
  bytes?: ArrayBuffer;
  /** Legacy records saved before bytes were stored directly. Read via captureBlob(). */
  blob?: Blob;
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

/** The stored original as a Blob (works for current and legacy records). */
export function captureBlob(c: Pick<LocalCapture, "bytes" | "blob" | "mime">): Blob {
  if (c.bytes) return new Blob([c.bytes], { type: c.mime });
  if (c.blob) return c.blob;
  throw new Error("No stored photo bytes");
}

/**
 * Copy the original bytes out of the picked file, hash them, persist bytes + id + hash, then read the
 * record back and re-hash the STORED bytes. Success is reported only if the persisted copy is
 * readable and identical.
 */
export async function saveCapture(input: SaveCaptureInput, db: PollTraceDB = getDB()): Promise<LocalCapture> {
  const bytes = await input.blob.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const record: LocalCapture = {
    id: crypto.randomUUID(),
    bytes,
    sha256,
    mime: input.blob.type || "application/octet-stream",
    sizeBytes: bytes.byteLength,
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
  if (!stored?.bytes || stored.bytes.byteLength !== bytes.byteLength || (await sha256Hex(stored.bytes)) !== sha256) {
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
