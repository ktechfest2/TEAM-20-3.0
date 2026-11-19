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
  InsertRevisionResult,
  ObjectStore,
  PutResult,
  ReferenceRecord,
  ReferenceReviewRecord,
  ReviewEventRecord,
  RevisionRecord,
} from "./types";
import type { EvidenceStatus } from "@/lib/contracts";
import { assertStagingKey, ImmutableObjectConflictError } from "./types";

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

const iso = (v: unknown) => new Date(String(v)).toISOString();
const intOrNull = (v: unknown) => (v == null ? null : Number(v));

const toRevision = (r: Row): RevisionRecord => ({
  id: String(r.id),
  evidenceId: String(r.evidence_id),
  revisionNumber: Number(r.revision_number),
  origin: r.origin as RevisionRecord["origin"],
  extractionMode: (r.extraction_mode ?? null) as RevisionRecord["extractionMode"],
  formType: r.form_type as RevisionRecord["formType"],
  pollingUnitCodeOnSheet: (r.polling_unit_code_on_sheet as string | null) ?? null,
  entries: ((r.result_entries as Row[] | null) ?? []).map((e) => ({
    partyCode: String(e.party_code),
    votes: intOrNull(e.votes),
    needsReview: Boolean(e.needs_review),
  })),
  accreditedVoters: intOrNull(r.accredited_voters),
  rejectedVotes: intOrNull(r.rejected_votes),
  validVotes: intOrNull(r.valid_votes),
  warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]).map(String) : [],
  rawExtraction: r.raw_extraction ?? null,
  humanConfirmed: Boolean(r.human_confirmed),
  basedOnRevision: intOrNull(r.based_on_revision),
  note: (r.note as string | null) ?? null,
  createdBy: r.created_by == null ? null : String(r.created_by),
  createdAt: iso(r.created_at),
});

const toReview = (r: Row): ReviewEventRecord => ({
  id: String(r.id),
  evidenceId: String(r.evidence_id),
  reviewerId: String(r.reviewer_id),
  decision: r.decision as ReviewEventRecord["decision"],
  independenceStatus: r.independence_status as ReviewEventRecord["independenceStatus"],
  reason: String(r.reason),
  createdAt: iso(r.created_at),
});

const toReference = (r: Row): ReferenceRecord => ({
  id: String(r.id),
  electionId: String(r.election_id),
  pollingUnitId: String(r.polling_unit_id),
  sourceType: r.source_type as ReferenceRecord["sourceType"],
  sourceDescription: String(r.source_description),
  sourceUrl: (r.source_url as string | null) ?? null,
  version: Number(r.version),
  figures: Object.fromEntries(
    Object.entries((r.figures as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)]),
  ),
  synthetic: Boolean(r.synthetic),
  createdBy: r.created_by == null ? null : String(r.created_by),
  createdAt: iso(r.created_at),
});

const toReferenceReview = (r: Row): ReferenceReviewRecord => ({
  id: String(r.id),
  referenceId: String(r.reference_id),
  reviewerId: String(r.reviewer_id),
  decision: r.decision as ReferenceReviewRecord["decision"],
  reason: String(r.reason),
  createdAt: iso(r.created_at),
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

  async updateEvidenceStatus(id: string, status: EvidenceStatus) {
    const { error } = await this.db.from("evidence").update({ status }).eq("id", id);
    if (error) throw new Error(`evidence status update failed: ${error.message}`);
  }

  async listEvidenceByStatus(statuses: EvidenceStatus[], limit: number) {
    const { data, error } = await this.db
      .from("evidence")
      .select("*")
      .in("status", statuses)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`evidence queue read failed: ${error.message}`);
    return (data ?? []).map(toEvidence);
  }

  async countEvidenceBySha(shas: string[]) {
    const out: Record<string, number> = Object.fromEntries(shas.map((s) => [s, 0]));
    if (shas.length === 0) return out;
    const { data, error } = await this.db.from("evidence").select("sha256").in("sha256", [...new Set(shas)]);
    if (error) throw new Error(`evidence sha count failed: ${error.message}`);
    for (const r of data ?? []) {
      const sha = String((r as Row).sha256);
      if (sha in out) out[sha] += 1;
    }
    return out;
  }

  async listRevisions(evidenceIds: string[]) {
    if (evidenceIds.length === 0) return [];
    const { data, error } = await this.db
      .from("result_revisions")
      .select("*, result_entries(*)")
      .in("evidence_id", evidenceIds)
      .order("evidence_id", { ascending: true })
      .order("revision_number", { ascending: true });
    if (error) throw new Error(`revisions read failed: ${error.message}`);
    return (data ?? []).map(toRevision);
  }

  /**
   * Atomic: revision + entries in one transaction via the insert_result_revision RPC
   * (migration 0005; execute granted to service_role only). Keys must match the SQL exactly.
   * A taken (evidence_id, revision_number) surfaces as PostgREST error code 23505.
   */
  async insertRevision(r: RevisionRecord): Promise<InsertRevisionResult> {
    const rev = {
      id: r.id,
      evidence_id: r.evidenceId,
      revision_number: r.revisionNumber,
      origin: r.origin,
      extraction_mode: r.extractionMode,
      form_type: r.formType,
      polling_unit_code_on_sheet: r.pollingUnitCodeOnSheet,
      accredited_voters: r.accreditedVoters,
      rejected_votes: r.rejectedVotes,
      valid_votes: r.validVotes,
      warnings: r.warnings,
      raw_extraction: r.rawExtraction ?? null,
      human_confirmed: r.humanConfirmed,
      based_on_revision: r.basedOnRevision,
      note: r.note,
      created_by: r.createdBy,
      created_at: r.createdAt,
    };
    const entries = r.entries.map((e) => ({ party_code: e.partyCode, votes: e.votes, needs_review: e.needsReview }));
    const { error } = await this.db.rpc("insert_result_revision", { rev, entries });
    if (error?.code === UNIQUE_VIOLATION) return { inserted: false };
    if (error) throw new Error(`revision insert failed: ${error.message}`);
    return { inserted: true, record: r };
  }

  async listReviews(evidenceIds: string[]) {
    if (evidenceIds.length === 0) return [];
    const { data, error } = await this.db
      .from("review_events")
      .select("*")
      .in("evidence_id", evidenceIds)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`reviews read failed: ${error.message}`);
    return (data ?? []).map(toReview);
  }

  async listEvidenceForUnit(electionId: string, pollingUnitId: string) {
    const { data, error } = await this.db
      .from("evidence")
      .select("*")
      .eq("election_id", electionId)
      .eq("polling_unit_id", pollingUnitId)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`unit evidence read failed: ${error.message}`);
    return (data ?? []).map(toEvidence);
  }

  async insertReference(r: ReferenceRecord) {
    const { error } = await this.db.from("reference_results").insert({
      id: r.id,
      election_id: r.electionId,
      polling_unit_id: r.pollingUnitId,
      source_type: r.sourceType,
      source_description: r.sourceDescription,
      source_url: r.sourceUrl,
      version: r.version,
      figures: r.figures,
      source_verified: false, // derived from reference_reviews; column intentionally unused
      synthetic: r.synthetic,
      created_by: r.createdBy,
      created_at: r.createdAt,
    });
    if (error?.code === UNIQUE_VIOLATION) return { inserted: false };
    if (error) throw new Error(`reference insert failed: ${error.message}`);
    return { inserted: true };
  }

  async getReference(id: string) {
    const { data, error } = await this.db.from("reference_results").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`reference read failed: ${error.message}`);
    return data ? toReference(data) : null;
  }

  async listReferences(electionId: string, pollingUnitId: string) {
    const { data, error } = await this.db
      .from("reference_results")
      .select("*")
      .eq("election_id", electionId)
      .eq("polling_unit_id", pollingUnitId)
      .order("version", { ascending: true });
    if (error) throw new Error(`references read failed: ${error.message}`);
    return (data ?? []).map(toReference);
  }

  async insertReferenceReview(r: ReferenceReviewRecord) {
    const { error } = await this.db.from("reference_reviews").insert({
      id: r.id,
      reference_id: r.referenceId,
      reviewer_id: r.reviewerId,
      decision: r.decision,
      reason: r.reason,
      created_at: r.createdAt,
    });
    if (error) throw new Error(`reference review insert failed: ${error.message}`);
  }

  async listReferenceReviews(referenceIds: string[]) {
    if (referenceIds.length === 0) return [];
    const { data, error } = await this.db
      .from("reference_reviews")
      .select("*")
      .in("reference_id", referenceIds)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`reference reviews read failed: ${error.message}`);
    return (data ?? []).map(toReferenceReview);
  }

  async insertReview(r: ReviewEventRecord) {
    const { error } = await this.db.from("review_events").insert({
      id: r.id,
      evidence_id: r.evidenceId,
      reviewer_id: r.reviewerId,
      decision: r.decision,
      independence_status: r.independenceStatus,
      reason: r.reason,
      created_at: r.createdAt,
    });
    if (error) throw new Error(`review insert failed: ${error.message}`);
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

  async putStaging(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    assertStagingKey(key);
    const { error } = await this.db.storage
      .from(EVIDENCE_BUCKET)
      .upload(key, bytes, { contentType: mime, upsert: true, cacheControl: "private, max-age=0" });
    if (error) throw new Error(`staging upload failed: ${error.message}`);
  }

  async removeStaging(key: string): Promise<void> {
    assertStagingKey(key);
    const { error } = await this.db.storage.from(EVIDENCE_BUCKET).remove([key]);
    if (error) throw new Error(`staging remove failed: ${error.message}`);
  }

  /**
   * Signed upload URL for the staging key only. upsert:true so a re-issued target works when a
   * previous attempt left bytes there. Supabase fixes the URL lifetime (2h); our own intent
   * token expiry is what finalize enforces. The PUT needs no API key: the token authorises it.
   */
  async createStagingUploadTarget(key: string, mime: string) {
    assertStagingKey(key);
    const { data, error } = await this.db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(`signed upload url failed: ${error?.message ?? "no data"}`);
    return { url: data.signedUrl, headers: { "content-type": mime, "x-upsert": "true" } };
  }
}

export function createSupabaseStorage(url: string, serviceRoleKey: string): EvidenceStorage {
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { mode: "SUPABASE", repo: new SupabaseRepository(db), objects: new SupabaseObjectStore(db) };
}
