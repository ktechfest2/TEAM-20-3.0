/**
 * LOCAL_DEV adapter. Development-only persistence under /.data (gitignored).
 * - Metadata: one JSON file, rewritten atomically (tmp + rename) under an in-process lock.
 * - Originals: write-once files (O_EXCL), mode 0600.
 * LIMITATIONS: single process only (lock is in-memory), not durable on serverless,
 * not remote storage. Never claim LOCAL_DEV evidence is "stored in the cloud".
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditEventRecord,
  ContributorRecord,
  EvidenceRecord,
  EvidenceRepository,
  EvidenceStorage,
  InsertEvidenceResult,
  InsertRevisionResult,
  ObjectStore,
  PutResult,
  ReviewEventRecord,
  RevisionRecord,
} from "./types";
import type { EvidenceStatus } from "@/lib/contracts";
import { assertStagingKey, ImmutableObjectConflictError } from "./types";

interface LocalDb {
  contributors: Record<string, ContributorRecord>;
  evidence: Record<string, EvidenceRecord>;
  audit: AuditEventRecord[];
  revisions: RevisionRecord[];
  reviews: ReviewEventRecord[];
}

const emptyDb = (): LocalDb => ({ contributors: {}, evidence: {}, audit: [], revisions: [], reviews: [] });
/** Deep copy so callers can never mutate stored (append-only) records in place. */
const clone = <T>(v: T): T => structuredClone(v);

/** Object keys are generated server-side, but still refuse anything path-like. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/i;
function safeObjectPath(root: string, key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid object key");
  const full = path.resolve(root, key);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid object key");
  return full;
}

class LocalRepository implements EvidenceRepository {
  private lock: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "polltrace-db.json");
  }

  /** Serialise every read-modify-write in this process. */
  private withLock<T>(fn: (db: LocalDb) => Promise<{ result: T; write: boolean }>): Promise<T> {
    const run = this.lock.then(async () => {
      const db = await this.load();
      const { result, write } = await fn(db);
      if (write) await this.save(db);
      return result;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<LocalDb> {
    try {
      return { ...emptyDb(), ...(JSON.parse(await readFile(this.file, "utf8")) as Partial<LocalDb>) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
      throw err;
    }
  }

  private async save(db: LocalDb): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  getContributor(id: string) {
    return this.withLock(async (db) => ({ result: db.contributors[id] ?? null, write: false }));
  }

  ensureContributor(record: ContributorRecord) {
    return this.withLock(async (db) => {
      const existing = db.contributors[record.id];
      if (existing) return { result: existing, write: false };
      db.contributors[record.id] = record;
      return { result: record, write: true };
    });
  }

  findEvidenceBySubmission(contributorId: string, clientSubmissionId: string) {
    return this.withLock(async (db) => ({
      result:
        Object.values(db.evidence).find(
          (e) => e.contributorId === contributorId && e.clientSubmissionId === clientSubmissionId,
        ) ?? null,
      write: false,
    }));
  }

  getEvidence(id: string) {
    return this.withLock(async (db) => ({ result: db.evidence[id] ? clone(db.evidence[id]) : null, write: false }));
  }

  insertEvidence(record: EvidenceRecord): Promise<InsertEvidenceResult> {
    return this.withLock<InsertEvidenceResult>(async (db) => {
      const existing = Object.values(db.evidence).find(
        (e) => e.contributorId === record.contributorId && e.clientSubmissionId === record.clientSubmissionId,
      );
      if (existing) return { result: { inserted: false, existing }, write: false };
      if (db.evidence[record.id]) throw new Error("evidence id collision");
      db.evidence[record.id] = record;
      return { result: { inserted: true, record }, write: true };
    });
  }

  appendAudit(event: AuditEventRecord) {
    return this.withLock(async (db) => {
      db.audit.push(event);
      return { result: undefined, write: true };
    });
  }

  listAudit(evidenceId: string) {
    return this.withLock(async (db) => ({
      result: clone(db.audit.filter((a) => a.evidenceId === evidenceId)),
      write: false,
    }));
  }

  updateEvidenceStatus(id: string, status: EvidenceStatus) {
    return this.withLock(async (db) => {
      const e = db.evidence[id];
      if (!e) throw new Error("evidence not found");
      e.status = status; // only mutable column
      return { result: undefined, write: true };
    });
  }

  listEvidenceByStatus(statuses: EvidenceStatus[], limit: number) {
    return this.withLock(async (db) => ({
      result: clone(
        Object.values(db.evidence)
          .filter((e) => statuses.includes(e.status))
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
          .slice(0, limit),
      ),
      write: false,
    }));
  }

  countEvidenceBySha(shas: string[]) {
    return this.withLock(async (db) => {
      const out: Record<string, number> = Object.fromEntries(shas.map((s) => [s, 0]));
      for (const e of Object.values(db.evidence)) if (e.sha256 in out) out[e.sha256] += 1;
      return { result: out, write: false };
    });
  }

  listRevisions(evidenceIds: string[]) {
    return this.withLock(async (db) => ({
      result: clone(
        db.revisions
          .filter((r) => evidenceIds.includes(r.evidenceId))
          .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId) || a.revisionNumber - b.revisionNumber),
      ),
      write: false,
    }));
  }

  insertRevision(record: RevisionRecord): Promise<InsertRevisionResult> {
    return this.withLock<InsertRevisionResult>(async (db) => {
      db.revisions ??= [];
      const taken = db.revisions.some(
        (r) => r.evidenceId === record.evidenceId && r.revisionNumber === record.revisionNumber,
      );
      if (taken) return { result: { inserted: false }, write: false };
      db.revisions.push(clone(record));
      return { result: { inserted: true, record: clone(record) }, write: true };
    });
  }

  listReviews(evidenceIds: string[]) {
    return this.withLock(async (db) => ({
      result: clone(
        (db.reviews ?? [])
          .filter((r) => evidenceIds.includes(r.evidenceId))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      ),
      write: false,
    }));
  }

  insertReview(record: ReviewEventRecord) {
    return this.withLock(async (db) => {
      db.reviews ??= [];
      db.reviews.push(clone(record));
      return { result: undefined, write: true };
    });
  }
}

class LocalObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  async putImmutable(key: string, bytes: Uint8Array, _mime: string, sha256: string): Promise<PutResult> {
    const full = safeObjectPath(this.root, key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    try {
      // 'wx' = O_CREAT | O_EXCL: fails if the file exists, so we can never overwrite.
      await writeFile(full, bytes, { flag: "wx", mode: 0o600 });
      return "CREATED";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const existing = await readFile(full);
      const existingSha = createHash("sha256").update(existing).digest("hex");
      if (existingSha === sha256) return "ALREADY_PRESENT_IDENTICAL";
      throw new ImmutableObjectConflictError(key);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(safeObjectPath(this.root, key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async putStaging(key: string, bytes: Uint8Array): Promise<void> {
    assertStagingKey(key);
    const full = safeObjectPath(this.root, key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, full);
  }

  async removeStaging(key: string): Promise<void> {
    assertStagingKey(key);
    await rm(safeObjectPath(this.root, key), { force: true });
  }

  async createStagingUploadTarget(key: string): Promise<null> {
    assertStagingKey(key);
    return null; // same-origin signed PUT route is issued by the service
  }
}

export function createLocalStorage(dataDir: string): EvidenceStorage {
  return {
    mode: "LOCAL_DEV",
    repo: new LocalRepository(dataDir),
    objects: new LocalObjectStore(path.join(dataDir, "objects")),
  };
}
