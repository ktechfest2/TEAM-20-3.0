/**
 * SUPABASE adapter (server-only). Uses the service-role key, which bypasses RLS,
 * so this module must never be imported from client components.
 * Tables: supabase/migrations/0001_init.sql. Bucket: private 'evidence-originals'.
 * STATUS: compile-checked only; not integration-tested (no credentials yet).
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AuditEventRecord,
  ContributorRecord,
  EvidenceRecord,
  EvidenceRepository,
  EvidenceStorage,
  InsertEvidenceResult,
  ObjectStore,
  PutResult,
} from "./types";
import { ImmutableObjectConflictError } from "./types";

export const EVIDENCE_BUCKET = "evidence-originals";
const UNIQUE_VIOLATION = "23505";

type Row = Record<string, unknown>;

const toContributor = (r: Row): ContributorRecord => ({
  id: String(r.id),
  alias: String(r.alias),
  role: r.role as ContributorRecord["role"],
  assurance: String(r.assurance),
  synthetic: Boolean(r.synthetic),
  createdAt: String(r.created_at),
});

const toEvidence = (r: Row): EvidenceRecord => ({
  id: String(r.id),
  clientSubmissionId: String(r.client_submission_id),
  contributorId: String(r.contributor_id),
  electionId: String(r.election_id),
  pollingUnitId: String(r.polling_unit_id),
  sourceType: r.source_type as EvidenceRecord["sourceType"],
  originalPath: String(r.original_path),
  sha256: String(r.sha256),
  mime: String(r.mime),
  sizeBytes: Number(r.size_bytes),
  capturedAtClaimed: r.captured_at_claimed == null ? null : new Date(String(r.captured_at_claimed)).toISOString(),
  receivedAt: new Date(String(r.received_at)).toISOString(),
  status: r.status as EvidenceRecord["status"],
  synthetic: Boolean(r.synthetic),
});

const toAudit = (r: Row): AuditEventRecord => ({
  id: String(r.id),
  evidenceId: r.evidence_id == null ? null : String(r.evidence_id),
  actorId: r.actor_id == null ? null : String(r.actor_id),
  eventType: String(r.event_type),
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  createdAt: new Date(String(r.created_at)).toISOString(),
});

class SupabaseRepository implements EvidenceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getContributor(id: string) {
    const { data, error } = await this.db.from("contributors").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`contributors read failed: ${error.message}`);
    return data ? toContributor(data) : null;
  }

  async ensureContributor(c: ContributorRecord) {
    const { error } = await this.db.from("contributors").insert({
      id: c.id,
      alias: c.alias,
      role: c.role,
      assurance: c.assurance,
      synthetic: c.synthetic,
      created_at: c.createdAt,
    });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(`contributors insert failed: ${error.message}`);
    const stored = await this.getContributor(c.id);
    if (!stored) throw new Error("contributor missing after insert");
    return stored;
  }

  async findEvidenceBySubmission(contributorId: string, clientSubmissionId: string) {
    const { data, error } = await this.db
      .from("evidence")
      .select("*")
      .eq("contributor_id", contributorId)
      .eq("client_submission_id", clientSubmissionId)
      .maybeSingle();
    if (error) throw new Error(`evidence read failed: ${error.message}`);
    return data ? toEvidence(data) : null;
  }

  async getEvidence(id: string) {
    const { data, error } = await this.db.from("evidence").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`evidence read failed: ${error.message}`);
    return data ? toEvidence(data) : null;
  }

  async insertEvidence(e: EvidenceRecord): Promise<InsertEvidenceResult> {
    const { data, error } = await this.db
      .from("evidence")
      .insert({
        id: e.id,
        client_submission_id: e.clientSubmissionId,
        contributor_id: e.contributorId,
        election_id: e.electionId,
        polling_unit_id: e.pollingUnitId,
        source_type: e.sourceType,
        original_path: e.originalPath,
        sha256: e.sha256,
        mime: e.mime,
        size_bytes: e.sizeBytes,
        captured_at_claimed: e.capturedAtClaimed,
        received_at: e.receivedAt,
        status: e.status,
        synthetic: e.synthetic,
      })
      .select("*")
      .single();
    if (error?.code === UNIQUE_VIOLATION) {
      const existing = await this.findEvidenceBySubmission(e.contributorId, e.clientSubmissionId);
      if (existing) return { inserted: false, existing };
    }
    if (error) throw new Error(`evidence insert failed: ${error.message}`);
    return { inserted: true, record: toEvidence(data) };
  }

  async appendAudit(a: AuditEventRecord) {
    const { error } = await this.db.from("audit_events").insert({
      id: a.id,
      evidence_id: a.evidenceId,
      actor_id: a.actorId,
      event_type: a.eventType,
      metadata: a.metadata,
      created_at: a.createdAt,
    });
    if (error) throw new Error(`audit insert failed: ${error.message}`);
  }

  async listAudit(evidenceId: string) {
    const { data, error } = await this.db
      .from("audit_events")
      .select("*")
      .eq("evidence_id", evidenceId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`audit read failed: ${error.message}`);
    return (data ?? []).map(toAudit);
  }
}

class SupabaseObjectStore implements ObjectStore {
  constructor(private readonly db: SupabaseClient) {}

  async putImmutable(key: string, bytes: Uint8Array, mime: string, sha256: string): Promise<PutResult> {
    const { error } = await this.db.storage
      .from(EVIDENCE_BUCKET)
      .upload(key, bytes, { contentType: mime, upsert: false, cacheControl: "private, max-age=0" });
    if (!error) return "CREATED";
    // upsert:false => the object already exists. Only accept if bytes are identical.
    const existing = await this.get(key);
    if (existing && createHash("sha256").update(existing).digest("hex") === sha256) {
      return "ALREADY_PRESENT_IDENTICAL";
    }
    if (existing) throw new ImmutableObjectConflictError(key);
    throw new Error(`object upload failed: ${error.message}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const { data, error } = await this.db.storage.from(EVIDENCE_BUCKET).download(key);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
}

export function createSupabaseStorage(url: string, serviceRoleKey: string): EvidenceStorage {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { mode: "SUPABASE", repo: new SupabaseRepository(db), objects: new SupabaseObjectStore(db) };
}
