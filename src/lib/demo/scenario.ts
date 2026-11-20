/**
 * Guided /demo scenario (server-only). Spec: src/lib/contracts/demo.ts header.
 * Every step calls the SAME service functions the API routes use (upload with server re-hash +
 * magic bytes, DEMO_FIXTURE extraction, human confirmation, reviews, reference import + source
 * review), acting as fixed SYNTHETIC demo actors. State is derived from storage, so stages are
 * idempotent and resumable after a partial failure. Nothing here inserts rows directly.
 */
import "server-only";
import { DEMO_ELECTION_ID, DEMO_UNIT_ID, DemoState, DemoStageId, type DemoStage } from "@/lib/contracts/demo";
import type { Principal } from "@/lib/auth/session";
import { createFixedWindowLimiter } from "@/lib/evidence/rate-limit";
import { fail, sha256HexNode, submitEvidence, type ServiceResult } from "@/lib/evidence/service";
import { latestRevision } from "@/lib/evidence/views";
import { confirmEvidence, extractEvidence, reviewEvidence } from "@/lib/evidence/workflow";
import { getUnitVerification, importReference, reviewReference, reviewStateFrom } from "@/lib/references/service";
import { findPollingUnit } from "@/lib/seed/registry";
import type { EvidenceRecord, EvidenceStorage } from "@/lib/storage";
import { demoEnabled } from "./admin";
import {
  DEMO_REFERENCE_DESCRIPTION,
  DEMO_REFERENCE_FIGURES,
  DEMO_REVIEWER_A,
  DEMO_REVIEWER_B,
  DEMO_SUBMISSION_IDS,
  DEMO_WITNESS_1,
  DEMO_WITNESS_2,
  DEMO_WITNESS_3,
  DEMO_WITNESS_FIGURES,
  DEMO_WITNESSES,
} from "./actors";
import { WITNESS_1_JPEG_BASE64, WITNESS_2_JPEG_BASE64 } from "./images";

export const AUDIT_DEMO_STAGE_RUN = "DEMO_STAGE_RUN";
export const AUDIT_DEMO_SCENARIO_RESET = "DEMO_SCENARIO_RESET";

export interface DemoDeps {
  storage: EvidenceStorage;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

const STAGES = DemoStageId.options;

const SUMMARIES: Record<DemoStageId, string> = {
  WITNESSES:
    "Synthetic Demo Witness 1 and 2 upload different photos of the same synthetic sheet, load the demo figures and confirm 145 / 210 / 42.",
  DUPLICATE:
    "Synthetic Demo Witness 3 uploads an exact copy of Witness 1's file (same SHA-256 fingerprint). A copy is not a new witness.",
  REVIEWS:
    "Synthetic Reviewer A accepts all three. Witness 1 and 2 are marked independent; the copy is accepted but not counted as independent.",
  REFERENCE:
    "Synthetic Reviewer B records a fictional reference (145 / 270 / 42) and Reviewer A checks its source. PARTY_B differs by +60 from the reference's perspective.",
};

const P = (a: { id: string; role: "CONTRIBUTOR" | "REVIEWER"; alias: string }): Principal => ({
  contributorId: a.id,
  role: a.role,
  alias: a.alias,
  synthetic: true,
});

/** Internal service calls are not user traffic; the admin gate rate-limits the trigger. */
const internalDeps = (d: DemoDeps) => ({ storage: d.storage, rateLimiter: createFixedWindowLimiter(1_000_000, 60_000), now: d.now });

class DemoStepError extends Error {
  constructor(readonly step: string, readonly result: ServiceResult) {
    super(`demo step ${step} failed with ${result.status}`);
  }
}
function expectOk(step: string, r: ServiceResult, ok: number[] = [200, 201]) {
  if (!ok.includes(r.status)) throw new DemoStepError(step, r);
  return r;
}

/* ------------------------------------------------------------------ derived state */

interface Snapshot {
  e1: EvidenceRecord | null;
  e2: EvidenceRecord | null;
  e3: EvidenceRecord | null;
  confirmed: (e: EvidenceRecord | null) => boolean;
  accepted: (e: EvidenceRecord | null) => boolean;
  referenceId: string | null;
  referenceConfirmed: boolean;
}

async function snapshot(d: DemoDeps): Promise<Snapshot> {
  const { repo } = d.storage;
  const [e1, e2, e3] = await Promise.all([
    repo.findEvidenceBySubmission(DEMO_WITNESS_1.id, DEMO_SUBMISSION_IDS.witness1),
    repo.findEvidenceBySubmission(DEMO_WITNESS_2.id, DEMO_SUBMISSION_IDS.witness2),
    repo.findEvidenceBySubmission(DEMO_WITNESS_3.id, DEMO_SUBMISSION_IDS.duplicate),
  ]);
  const ids = [e1, e2, e3].filter((e): e is EvidenceRecord => e !== null).map((e) => e.id);
  const [revisions, reviews, refs] = await Promise.all([
    repo.listRevisions(ids),
    repo.listReviews(ids),
    repo.listReferences(DEMO_ELECTION_ID, DEMO_UNIT_ID),
  ]);
  const demoRef =
    refs
      .filter((r) => r.createdBy === DEMO_REVIEWER_B.id && r.sourceType === "SYNTHETIC_DEMO" && r.sourceDescription === DEMO_REFERENCE_DESCRIPTION)
      .at(-1) ?? null;
  const refReviews = demoRef ? await repo.listReferenceReviews([demoRef.id]) : [];

  const confirmed = (e: EvidenceRecord | null) => {
    if (!e) return false;
    return latestRevision(revisions.filter((r) => r.evidenceId === e.id))?.humanConfirmed === true;
  };
  const accepted = (e: EvidenceRecord | null) => {
    if (!e) return false;
    const latest = latestRevision(revisions.filter((r) => r.evidenceId === e.id));
    const last = reviews.filter((r) => r.evidenceId === e.id).at(-1);
    return last?.decision === "ACCEPTED" && (!latest || last.createdAt >= latest.createdAt);
  };
  return {
    e1,
    e2,
    e3,
    confirmed,
    accepted,
    referenceId: demoRef?.id ?? null,
    referenceConfirmed: reviewStateFrom(refReviews) === "CONFIRMED",
  };
}

function stageDone(s: Snapshot, stage: DemoStageId): boolean {
  switch (stage) {
    case "WITNESSES":
      return s.confirmed(s.e1) && s.confirmed(s.e2);
    case "DUPLICATE":
      return s.confirmed(s.e3);
    case "REVIEWS":
      return s.accepted(s.e1) && s.accepted(s.e2) && s.accepted(s.e3);
    case "REFERENCE":
      return s.referenceId !== null && s.referenceConfirmed;
  }
}

export async function getDemoState(d: DemoDeps): Promise<DemoState> {
  const s = await snapshot(d);
  const verification = await getUnitVerification(DEMO_UNIT_ID, DEMO_ELECTION_ID, { ...internalDeps(d) });
  const stages: DemoStage[] = STAGES.map((id) => ({ id, done: stageDone(s, id), summary: SUMMARIES[id] }));
  return DemoState.parse({
    enabled: demoEnabled(d.env ?? process.env),
    unitId: DEMO_UNIT_ID,
    electionId: DEMO_ELECTION_ID,
    stages,
    evidence: { witness1: s.e1?.id ?? null, witness2: s.e2?.id ?? null, duplicate: s.e3?.id ?? null },
    referenceId: s.referenceId,
    verificationStatus: (verification.body as { status: DemoState["verificationStatus"] }).status,
    synthetic: true,
  });
}

/* ------------------------------------------------------------------ stage steps */

async function ensureActors(d: DemoDeps) {
  const createdAt = (d.now ?? (() => new Date()))().toISOString();
  for (const a of [...DEMO_WITNESSES, DEMO_REVIEWER_A, DEMO_REVIEWER_B]) await d.storage.repo.ensureContributor({ ...a, createdAt });
}

/** Upload (or replay) -> DEMO_FIXTURE draft if none -> confirm if latest not confirmed. */
async function witnessSubmits(d: DemoDeps, actor: typeof DEMO_WITNESS_1, csid: string, b64: string, actions: string[]) {
  const deps = internalDeps(d);
  const p = P(actor);
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  const up = expectOk(
    `upload:${actor.alias}`,
    await submitEvidence(
      {
        principal: p,
        file: bytes,
        fields: {
          electionId: DEMO_ELECTION_ID,
          pollingUnitId: DEMO_UNIT_ID,
          clientSubmissionId: csid,
          originalSha256: sha256HexNode(bytes),
          sourceType: "WITNESS_PHOTO",
        },
      },
      deps,
    ),
  );
  const id = (up.body as { id: string }).id;
  if (up.status === 201) actions.push(`${actor.alias} uploaded`);

  let latest = latestRevision(await d.storage.repo.listRevisions([id]));
  if (!latest) {
    expectOk(`extract:${actor.alias}`, await extractEvidence(p, id, { mode: "DEMO_FIXTURE" }, deps));
    latest = latestRevision(await d.storage.repo.listRevisions([id]));
    actions.push(`${actor.alias} loaded demo figures`);
  }
  if (latest && !latest.humanConfirmed) {
    expectOk(
      `confirm:${actor.alias}`,
      await confirmEvidence(
        p,
        id,
        {
          basedOnRevision: latest.revisionNumber,
          formType: "EC8A",
          pollingUnitCodeOnSheet: findPollingUnit(DEMO_UNIT_ID)?.code ?? null,
          entries: Object.entries(DEMO_WITNESS_FIGURES).map(([partyCode, votes]) => ({ partyCode, votes, needsReview: false })),
          accreditedVoters: null,
          rejectedVotes: null,
          validVotes: 397,
          note: "Synthetic demo witness confirmation.",
        },
        deps,
      ),
    );
    actions.push(`${actor.alias} confirmed 145 / 210 / 42`);
  }
}

async function runStageSteps(stage: DemoStageId, d: DemoDeps, s: Snapshot, actions: string[]) {
  const deps = internalDeps(d);
  const revA = P(DEMO_REVIEWER_A);
  switch (stage) {
    case "WITNESSES":
      await witnessSubmits(d, DEMO_WITNESS_1, DEMO_SUBMISSION_IDS.witness1, WITNESS_1_JPEG_BASE64, actions);
      await witnessSubmits(d, DEMO_WITNESS_2, DEMO_SUBMISSION_IDS.witness2, WITNESS_2_JPEG_BASE64, actions);
      return;
    case "DUPLICATE":
      // Witness 1's exact bytes: same SHA-256, different submitter.
      await witnessSubmits(d, DEMO_WITNESS_3, DEMO_SUBMISSION_IDS.duplicate, WITNESS_1_JPEG_BASE64, actions);
      return;
    case "REVIEWS": {
      const plan: Array<[EvidenceRecord | null, "REVIEWER_CONFIRMED" | "UNVERIFIED", string]> = [
        [s.e1, "REVIEWER_CONFIRMED", "Synthetic demo: figures legible; a distinct original from a different witness."],
        [s.e2, "REVIEWER_CONFIRMED", "Synthetic demo: figures legible; a distinct original from a different witness."],
        [s.e3, "UNVERIFIED", "Synthetic demo: figures legible, but this file is an exact copy of another submission; independence not established."],
      ];
      for (const [e, independenceStatus, reason] of plan) {
        if (!e || s.accepted(e)) continue;
        expectOk(`review:${e.id}`, await reviewEvidence(revA, e.id, { decision: "ACCEPTED", independenceStatus, reason }, deps));
        actions.push(`Reviewer A accepted ${e.id} (${independenceStatus})`);
      }
      return;
    }
    case "REFERENCE": {
      let refId = s.referenceId;
      if (!refId) {
        const r = expectOk(
          "reference:import",
          await importReference(
            P(DEMO_REVIEWER_B),
            {
              electionId: DEMO_ELECTION_ID,
              pollingUnitId: DEMO_UNIT_ID,
              sourceType: "SYNTHETIC_DEMO",
              sourceDescription: DEMO_REFERENCE_DESCRIPTION,
              figures: { ...DEMO_REFERENCE_FIGURES },
              synthetic: true,
            },
            deps,
          ),
        );
        refId = (r.body as { id: string }).id;
        actions.push("Reviewer B recorded the synthetic reference");
      }
      if (!s.referenceConfirmed || s.referenceId !== refId) {
        expectOk(
          "reference:review",
          await reviewReference(revA, refId, { decision: "SOURCE_CONFIRMED", reason: "Synthetic demo: source provenance checked (fictional record)." }, deps),
        );
        actions.push("Reviewer A confirmed the reference source");
      }
      return;
    }
  }
}

export type DemoRunResult = { ok: true; state: DemoState; ran: boolean } | { ok: false; result: ServiceResult };

export async function runDemoStage(stageRaw: string, d: DemoDeps): Promise<DemoRunResult> {
  const parsed = DemoStageId.safeParse(stageRaw);
  if (!parsed.success) return { ok: false, result: fail(404, "UNKNOWN_DEMO_STAGE", `Unknown demo stage. Expected one of ${STAGES.join(", ")}.`) };
  const stage = parsed.data;

  const before = await snapshot(d);
  const missing = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => !stageDone(before, s));
  if (missing.length) {
    return { ok: false, result: fail(409, "DEMO_STAGE_ORDER", `Run ${missing.join(", ")} first.`, { missing }) };
  }
  if (stageDone(before, stage)) return { ok: true, state: await getDemoState(d), ran: false }; // idempotent

  await ensureActors(d);
  const actions: string[] = [];
  try {
    await runStageSteps(stage, d, before, actions);
  } catch (err) {
    if (err instanceof DemoStepError) {
      const inner = (err.result.body as { error?: { code?: string } }).error?.code ?? "UNKNOWN";
      return { ok: false, result: fail(500, "DEMO_STAGE_FAILED", `Demo step ${err.step} failed (${inner}). Re-running the stage resumes it.`, { step: err.step, innerCode: inner }) };
    }
    throw err;
  }

  await d.storage.repo.appendAudit({
    id: crypto.randomUUID(),
    evidenceId: null,
    actorId: null,
    eventType: AUDIT_DEMO_STAGE_RUN,
    metadata: { stage, actions, unitId: DEMO_UNIT_ID, synthetic: true },
    createdAt: (d.now ?? (() => new Date()))().toISOString(),
  });
  return { ok: true, state: await getDemoState(d), ran: true };
}

/** Deletes ONLY the demo actors' rows on the demo unit (see repo.resetDemoScenario), then their originals. */
export async function resetDemo(d: DemoDeps): Promise<DemoState> {
  const witnessIds = DEMO_WITNESSES.map((w) => w.id);
  const counts = await d.storage.repo.resetDemoScenario(DEMO_UNIT_ID, witnessIds, [DEMO_REVIEWER_A.id, DEMO_REVIEWER_B.id]);
  let objectsRemoved = true;
  try {
    await d.storage.objects.removeDemoOriginals(counts.originalPaths, witnessIds);
  } catch (err) {
    objectsRemoved = false; // rows are gone; leftover private objects are unreachable orphans
    console.warn("[polltrace] demo original removal failed", err);
  }
  const { originalPaths, ...rest } = counts;
  await d.storage.repo.appendAudit({
    id: crypto.randomUUID(),
    evidenceId: null,
    actorId: null,
    eventType: AUDIT_DEMO_SCENARIO_RESET,
    metadata: { unitId: DEMO_UNIT_ID, ...rest, originalsRemoved: objectsRemoved ? originalPaths.length : 0, synthetic: true },
    createdAt: (d.now ?? (() => new Date()))().toISOString(),
  });
  return getDemoState(d);
}
