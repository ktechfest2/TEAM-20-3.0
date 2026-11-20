/**
 * MANUAL smoke test against the REAL Supabase project. Skipped unless POLLTRACE_SUPABASE_SMOKE=1.
 *   POLLTRACE_SUPABASE_SMOKE=1 npx vitest run src/lib/storage/supabase.smoke.test.ts
 * Reads .env.local in-process; never prints keys or signed URLs (they contain tokens).
 * Creates SYNTHETIC rows (synthetic election/PU, synthetic smoke contributor). Evidence rows
 * cannot be deleted (append-only audit references them), so created ids are printed.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enabled = process.env.POLLTRACE_SUPABASE_SMOKE === "1";
/** Reserved smoke-test unit. NEVER the live demo unit demo-pu-012 (demo reset won't clean smoke rows). */
const SMOKE_UNIT = process.env.POLLTRACE_SMOKE_UNIT ?? "demo-pu-102";
if (SMOKE_UNIT === "demo-pu-012") throw new Error("Smoke tests must not write to the live demo unit demo-pu-012");
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

// 1x1 PNG (real, decodable) + a per-run nonce chunk after IEND so hashes differ per run.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const png = (nonce: string) => new Uint8Array(Buffer.concat([PNG_1PX, Buffer.from(nonce)]));

describe.skipIf(!enabled)("SUPABASE smoke: direct signed upload + finalize", () => {
  it("end to end", { timeout: 60_000 }, async () => {
    const { createStorage } = await import("@/lib/storage");
    const { createFixedWindowLimiter } = await import("@/lib/evidence/rate-limit");
    const { initUpload, finalizeUpload, stagingKeyFor } = await import("@/lib/evidence/uploads");
    const { submitEvidence, sha256HexNode } = await import("@/lib/evidence/service");

    const storage = createStorage(process.env);
    expect(storage.mode).toBe("SUPABASE");
    const deps = { storage, rateLimiter: createFixedWindowLimiter(1000, 60_000) };
    const supaHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;

    const contributor = await storage.repo.ensureContributor({
      id: randomUUID(),
      alias: "Synthetic smoke-test contributor",
      role: "CONTRIBUTOR",
      assurance: "SYNTHETIC_DEMO",
      synthetic: true,
      createdAt: new Date().toISOString(),
    });
    const p = { contributorId: contributor.id, role: contributor.role, alias: contributor.alias, synthetic: true };
    const log: Record<string, unknown> = { contributorId: contributor.id };

    const meta = (csid: string, bytes: Uint8Array) => ({
      electionId: "demo-election",
      pollingUnitId: SMOKE_UNIT,
      clientSubmissionId: csid,
      originalSha256: sha256HexNode(bytes),
      sizeBytes: bytes.byteLength,
      mime: "image/png",
      sourceType: "OBSERVER_PHOTO",
    });
    type Target = { state: string; uploadUrl: string; uploadHeaders: Record<string, string>; intentToken: string };
    const putTo = async (t: Target, bytes: Uint8Array) => {
      const res = await fetch(t.uploadUrl, { method: "PUT", headers: t.uploadHeaders, body: new Blob([bytes as BlobPart]) });
      return { status: res.status, body: res.ok ? "ok" : (await res.text()).slice(0, 200) };
    };

    // --- A. happy path, with re-init + re-PUT over an existing staging object (upsert) ---
    const csidA = randomUUID();
    const bytesA = png(`smoke-A-${csidA}`);
    const t1 = (await initUpload(p, meta(csidA, bytesA), deps)).body as Target;
    log.uploadHost = new URL(t1.uploadUrl).host;
    log.uploadHostIsSupabase = log.uploadHost === supaHost;
    log.putPartial = await putTo(t1, bytesA.slice(0, 10));
    const t2 = (await initUpload(p, meta(csidA, bytesA), deps)).body as Target;
    log.reinitState = t2.state;
    log.putOverExistingStaging = await putTo(t2, bytesA);
    const finA = await finalizeUpload(p, { clientSubmissionId: csidA, intentToken: t2.intentToken }, deps);
    log.finalizeA = { status: finA.status, body: finA.body };
    const replayA = await finalizeUpload(p, { clientSubmissionId: csidA, intentToken: t2.intentToken }, deps);
    log.replayA = { status: replayA.status, same: JSON.stringify(replayA.body) === JSON.stringify(finA.body) };
    const initAfter = await initUpload(p, meta(csidA, bytesA), deps);
    log.initAfterReceived = { status: initAfter.status, state: (initAfter.body as { state: string }).state };
    log.stagingAfterFinalizeA = (await storage.objects.get(stagingKeyFor(p.contributorId, csidA))) ? "PRESENT" : "GONE";
    const recA = await storage.repo.getEvidence((finA.body as { id: string }).id);
    log.recordA = recA && { sourceType: recA.sourceType, status: recA.status, synthetic: recA.synthetic, mime: recA.mime, sizeBytes: recA.sizeBytes };
    const origA = recA ? await storage.objects.get(recA.originalPath) : null;
    log.originalA = origA ? { sha256Matches: sha256HexNode(origA) === sha256HexNode(bytesA) } : "MISSING";
    log.auditA = (await storage.repo.listAudit(recA!.id)).map((a) => a.eventType);

    // --- B. tampered staged bytes -> 422, staging removed, no row ---
    const csidB = randomUUID();
    const bytesB = png(`smoke-B-${csidB}`);
    const tB = (await initUpload(p, meta(csidB, bytesB), deps)).body as Target;
    log.putB = await putTo(tB, png("tampered"));
    const finB = await finalizeUpload(p, { clientSubmissionId: csidB, intentToken: tB.intentToken }, deps);
    log.finalizeB = { status: finB.status, code: (finB.body as { error?: { code: string } }).error?.code };
    log.rowB = (await storage.repo.findEvidenceBySubmission(p.contributorId, csidB)) ? "PRESENT" : "NONE";
    log.stagingB = (await storage.objects.get(stagingKeyFor(p.contributorId, csidB))) ? "PRESENT" : "GONE";

    // --- C. PUT outside our staging key with a signed URL for another path is impossible to
    //        request (server only signs staging keys); check the multipart path still works ---
    const csidC = randomUUID();
    const bytesC = png(`smoke-C-${csidC}`);
    const multi = await submitEvidence(
      {
        principal: p,
        file: bytesC,
        fields: { electionId: "demo-election", pollingUnitId: SMOKE_UNIT, clientSubmissionId: csidC, originalSha256: sha256HexNode(bytesC), sourceType: "WITNESS_PHOTO" },
      },
      deps,
    );
    log.multipartC = { status: multi.status, id: (multi.body as { id?: string }).id };

    console.log("SUPABASE SMOKE RESULT", JSON.stringify(log, null, 2));
    if (process.env.POLLTRACE_SMOKE_OUT) (await import("node:fs")).writeFileSync(process.env.POLLTRACE_SMOKE_OUT, JSON.stringify(log, null, 2));

    expect(log.uploadHostIsSupabase).toBe(true);
    expect((log.putOverExistingStaging as { status: number }).status).toBe(200);
    expect(finA.status).toBe(201);
    expect(replayA.status).toBe(200);
    expect(log.initAfterReceived).toEqual({ status: 200, state: "ALREADY_RECEIVED" });
    expect(log.stagingAfterFinalizeA).toBe("GONE");
    expect(log.originalA).toEqual({ sha256Matches: true });
    expect(log.auditA).toEqual(["EVIDENCE_RECEIVED"]);
    expect(recA?.sourceType).toBe("OBSERVER_PHOTO");
    expect(finB.status).toBe(422);
    expect(log.rowB).toBe("NONE");
    expect(log.stagingB).toBe("GONE");
    expect(multi.status).toBe(201);
  });
});

describe.skipIf(!enabled)("SUPABASE smoke: extract + confirm + review + trace", () => {
  it("end to end", { timeout: 60_000 }, async () => {
    const { createStorage } = await import("@/lib/storage");
    const { createFixedWindowLimiter } = await import("@/lib/evidence/rate-limit");
    const { submitEvidence, sha256HexNode } = await import("@/lib/evidence/service");
    const wf = await import("@/lib/evidence/workflow");
    const { DEMO_REVIEWERS } = await import("@/lib/auth/demo-reviewers");
    const { createClient } = await import("@supabase/supabase-js");

    const storage = createStorage(process.env);
    expect(storage.mode).toBe("SUPABASE");
    const deps = { storage, rateLimiter: createFixedWindowLimiter(1000, 60_000) };

    const ownerRec = await storage.repo.ensureContributor({
      id: randomUUID(),
      alias: "Synthetic smoke-test contributor",
      role: "CONTRIBUTOR",
      assurance: "SYNTHETIC_DEMO",
      synthetic: true,
      createdAt: new Date().toISOString(),
    });
    const owner = { contributorId: ownerRec.id, role: ownerRec.role, alias: ownerRec.alias, synthetic: true };
    const revRec = await storage.repo.ensureContributor({ ...DEMO_REVIEWERS[0], createdAt: new Date().toISOString() });
    const reviewer = { contributorId: revRec.id, role: revRec.role, alias: revRec.alias, synthetic: true };

    const bytes = png(`smoke-wf-${randomUUID()}`);
    const up = await submitEvidence(
      {
        principal: owner,
        file: bytes,
        fields: {
          electionId: "demo-election",
          pollingUnitId: SMOKE_UNIT,
          clientSubmissionId: randomUUID(),
          originalSha256: sha256HexNode(bytes),
          capturedAtClaimed: new Date(Date.now() - 60_000).toISOString(),
        },
      },
      deps,
    );
    const id = (up.body as { id: string }).id;
    const log: Record<string, unknown> = { upload: up.status, evidenceId: id, ownerId: owner.contributorId };

    const acceptEarly = await wf.reviewEvidence(reviewer, id, { decision: "ACCEPTED", independenceStatus: "UNVERIFIED", reason: "smoke" }, deps);
    log.acceptBeforeConfirm = { status: acceptEarly.status, code: (acceptEarly.body as { error?: { code: string } }).error?.code };

    const ex = await wf.extractEvidence(owner, id, { mode: "AUTO" }, deps);
    log.extract = { status: ex.status, modeUsed: (ex.body as { modeUsed?: string }).modeUsed };
    const rv = await wf.extractEvidence(owner, id, { mode: "REAL_VISION" }, deps);
    log.extractRealVision = rv.status;

    const confirmBody = {
      basedOnRevision: 1,
      formType: "EC8A",
      pollingUnitCodeOnSheet: null, // unit-agnostic (a mismatching code would now block ACCEPTED)
      entries: [
        { partyCode: "PARTY_A", votes: 145, needsReview: false },
        { partyCode: "PARTY_B", votes: null, needsReview: true },
        { partyCode: "PARTY_C", votes: 42, needsReview: false },
      ],
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: 397,
      note: "smoke: PARTY_B unreadable",
    };
    const conf = await wf.confirmEvidence(owner, id, confirmBody, deps);
    log.confirm = { status: conf.status, revision: (conf.body as { revisionNumber?: number }).revisionNumber };
    log.confirmStale = (await wf.confirmEvidence(owner, id, confirmBody, deps)).status;
    log.confirmByReviewer = (await wf.confirmEvidence(reviewer, id, { ...confirmBody, basedOnRevision: 2 }, deps)).status;

    const flag = await wf.reviewEvidence(reviewer, id, { decision: "FLAGGED", independenceStatus: "UNVERIFIED", reason: "smoke flag" }, deps);
    const accept = await wf.reviewEvidence(reviewer, id, { decision: "ACCEPTED", independenceStatus: "REVIEWER_CONFIRMED", reason: "smoke accept" }, deps);
    log.reviews = [flag.status, (flag.body as { status: string }).status, accept.status, (accept.body as { status: string }).status];
    log.selfReview = (await wf.reviewEvidence({ ...owner, role: "REVIEWER" }, id, { decision: "FLAGGED", independenceStatus: "UNVERIFIED", reason: "self" }, deps)).status;

    const queue = (await wf.getReviewQueue(reviewer, deps)).body as { items: Array<{ id: string }> };
    log.inQueueAfterAccept = queue.items.some((i) => i.id === id);

    const tr = await wf.getTrace(reviewer, id, deps);
    const t = tr.body as {
      timeline: Array<{ type: string; summary: string }>;
      revisions: Array<{ revisionNumber: number; origin: string; entries: Array<{ partyCode: string; votes: number | null; needsReview: boolean }> }>;
      evidence: { status: string; storageMode: string };
      integrity: unknown;
      permissions: unknown;
    };
    log.trace = {
      status: tr.status,
      timeline: t.timeline.map((e) => e.type),
      revisions: t.revisions.map((r) => `${r.revisionNumber}:${r.origin}`),
      rev2Entries: t.revisions[1]?.entries,
      evidenceStatus: t.evidence.status,
      storageMode: t.evidence.storageMode,
      integrity: t.integrity,
      permissions: t.permissions,
      bannedWords: t.timeline.some((e) => /verif|fraud|authentic/i.test(e.summary)),
    };

    // RPC path under contention: 3 concurrent extracts after ACCEPTED (exercises 23505 -> retry).
    const concurrent = await Promise.all([1, 2, 3].map(() => wf.extractEvidence(owner, id, { mode: "AUTO" }, deps)));
    const revsAfter = await storage.repo.listRevisions([id]);
    log.concurrentExtracts = {
      statuses: concurrent.map((r) => r.status),
      revisionNumbers: revsAfter.map((r) => r.revisionNumber),
      entriesPerRevision: revsAfter.map((r) => r.entries.length),
      storedStatus: (await storage.repo.getEvidence(id))?.status,
      lastExtractAudit: (await storage.repo.listAudit(id))
        .filter((a) => a.eventType === "EXTRACTION_CREATED")
        .map((a) => [a.metadata.previousStatus, a.metadata.newStatus, a.metadata.statusResetAfterReview]),
    };

    // DB-level append-only check (service role bypasses RLS but not triggers).
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const upd = await db.from("result_revisions").update({ note: "tamper" }).eq("evidence_id", id).eq("revision_number", 1);
    log.revisionUpdateBlocked = upd.error ? upd.error.message : "NOT BLOCKED";
    const del = await db.from("review_events").delete().eq("evidence_id", id);
    log.reviewDeleteBlocked = del.error ? del.error.message : "NOT BLOCKED";

    console.log("SUPABASE WORKFLOW SMOKE", JSON.stringify(log, null, 2));
    if (process.env.POLLTRACE_SMOKE_OUT) (await import("node:fs")).writeFileSync(process.env.POLLTRACE_SMOKE_OUT, JSON.stringify(log, null, 2));

    expect(up.status).toBe(201);
    expect(log.acceptBeforeConfirm).toEqual({ status: 409, code: "NO_CONFIRMED_REVISION" });
    expect(log.extract).toEqual({ status: 201, modeUsed: "DEMO_FIXTURE" });
    expect(log.extractRealVision).toBe(422);
    expect(log.confirm).toEqual({ status: 201, revision: 2 });
    expect(log.confirmStale).toBe(409);
    expect(log.confirmByReviewer).toBe(403);
    expect(log.reviews).toEqual([201, "PENDING_REVIEW", 201, "ACCEPTED"]);
    expect(log.selfReview).toBe(403);
    expect(log.inQueueAfterAccept).toBe(false);
    expect(tr.status).toBe(200);
    expect((log.trace as { timeline: string[] }).timeline).toEqual(["CAPTURE_CLAIMED", "RECEIVED", "EXTRACTION", "HUMAN_CONFIRMATION", "REVIEW", "REVIEW"]);
    expect((log.trace as { bannedWords: boolean }).bannedWords).toBe(false);
    expect(log.concurrentExtracts).toMatchObject({
      statuses: [201, 201, 201],
      revisionNumbers: [1, 2, 3, 4, 5],
      entriesPerRevision: [3, 3, 3, 3, 3],
      storedStatus: "PENDING_REVIEW",
    });
    expect(log.revisionUpdateBlocked).not.toBe("NOT BLOCKED");
    expect(log.reviewDeleteBlocked).not.toBe("NOT BLOCKED");
  });
});

describe.skipIf(!enabled)("SUPABASE smoke: references + unit verification (+60)", () => {
  it("end to end on an otherwise empty synthetic unit", { timeout: 90_000 }, async () => {
    const UNIT = SMOKE_UNIT;
    expect(UNIT).not.toBe("demo-pu-012");
    const { createStorage } = await import("@/lib/storage");
    const { createFixedWindowLimiter } = await import("@/lib/evidence/rate-limit");
    const { submitEvidence, sha256HexNode } = await import("@/lib/evidence/service");
    const wf = await import("@/lib/evidence/workflow");
    const refs = await import("@/lib/references/service");
    const { DEMO_REVIEWERS } = await import("@/lib/auth/demo-reviewers");
    const { createClient } = await import("@supabase/supabase-js");

    const storage = createStorage(process.env);
    expect(storage.mode).toBe("SUPABASE");
    const deps = { storage, rateLimiter: createFixedWindowLimiter(1000, 60_000) };
    const now = () => new Date().toISOString();
    const asP = (c: { id: string; role: "CONTRIBUTOR" | "REVIEWER"; alias: string }) => ({ contributorId: c.id, role: c.role, alias: c.alias, synthetic: true });
    const mk = async () =>
      asP(await storage.repo.ensureContributor({ id: randomUUID(), alias: "Synthetic smoke-test contributor", role: "CONTRIBUTOR", assurance: "SYNTHETIC_DEMO", synthetic: true, createdAt: now() }));
    const [w1, w2] = [await mk(), await mk()];
    const revA = asP(await storage.repo.ensureContributor({ ...DEMO_REVIEWERS[0], createdAt: now() }));
    const revB = asP(await storage.repo.ensureContributor({ ...DEMO_REVIEWERS[1], createdAt: now() }));

    const log: Record<string, unknown> = { unit: UNIT };
    const evidenceIds: string[] = [];
    for (const [w, tag] of [[w1, "A"], [w2, "B"]] as const) {
      const bytes = png(`smoke-verif-${tag}-${randomUUID()}`);
      const up = await submitEvidence(
        { principal: w, file: bytes, fields: { electionId: "demo-election", pollingUnitId: UNIT, clientSubmissionId: randomUUID(), originalSha256: sha256HexNode(bytes) } },
        deps,
      );
      const id = (up.body as { id: string }).id;
      evidenceIds.push(id);
      const ex = await wf.extractEvidence(w, id, { mode: "MANUAL" }, deps);
      const cf = await wf.confirmEvidence(
        w,
        id,
        {
          basedOnRevision: 1,
          formType: "EC8A",
          pollingUnitCodeOnSheet: null,
          entries: [
            { partyCode: "PARTY_A", votes: 145, needsReview: false },
            { partyCode: "PARTY_B", votes: 210, needsReview: false },
            { partyCode: "PARTY_C", votes: 42, needsReview: false },
          ],
          accreditedVoters: null,
          rejectedVotes: null,
          validVotes: 397,
        },
        deps,
      );
      const rv = await wf.reviewEvidence(revA, id, { decision: "ACCEPTED", independenceStatus: "REVIEWER_CONFIRMED", reason: "smoke accept" }, deps);
      log[`witness${tag}`] = [up.status, ex.status, cf.status, rv.status];
    }
    log.evidenceIds = evidenceIds;
    const v0 = (await refs.getUnitVerification(UNIT, "demo-election", deps)).body as { status: string };
    log.statusBeforeReference = v0.status;

    const imp = await refs.importReference(
      revB,
      { electionId: "demo-election", pollingUnitId: UNIT, sourceType: "SYNTHETIC_DEMO", sourceDescription: "Smoke-test synthetic reference (fictional)", figures: { PARTY_A: 145, PARTY_B: 270, PARTY_C: 42 }, synthetic: true },
      deps,
    );
    const ref = imp.body as { id: string; version: number; reviewState: string };
    log.import = { status: imp.status, version: ref.version, reviewState: ref.reviewState, referenceId: ref.id };
    const vUnconfirmed = (await refs.getUnitVerification(UNIT, "demo-election", deps)).body as { status: string; differenceUnconfirmed: boolean };
    log.unconfirmed = { status: vUnconfirmed.status, differenceUnconfirmed: vUnconfirmed.differenceUnconfirmed };
    log.selfReview = (await refs.reviewReference(revB, ref.id, { decision: "SOURCE_CONFIRMED", reason: "self" }, deps)).status;
    const rr = await refs.reviewReference(revA, ref.id, { decision: "SOURCE_CONFIRMED", reason: "smoke source check" }, deps);
    log.referenceReview = { status: rr.status, reviewState: (rr.body as { reviewState: string }).reviewState };

    const v = (await refs.getUnitVerification(UNIT, "demo-election", deps)).body as {
      status: string;
      independentSources: number;
      differences: Array<{ partyCode: string; referenceMinusWitness: number | null }>;
      differenceUnconfirmed: boolean;
      synthetic: boolean;
      reference: { reviewState: string; sourceVerified: boolean };
    };
    log.final = {
      status: v.status,
      independentSources: v.independentSources,
      differences: Object.fromEntries(v.differences.map((d) => [d.partyCode, d.referenceMinusWitness])),
      differenceUnconfirmed: v.differenceUnconfirmed,
      synthetic: v.synthetic,
      reference: { reviewState: v.reference.reviewState, sourceVerified: v.reference.sourceVerified },
      containsContributorIds: [w1, w2, revA, revB].some((p) => JSON.stringify(v).includes(p.contributorId)),
    };

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const u1 = await db.from("reference_results").update({ figures: { PARTY_B: 210 } }).eq("id", ref.id);
    const u2 = await db.from("reference_reviews").delete().eq("reference_id", ref.id);
    log.referenceUpdateBlocked = u1.error?.message ?? "NOT BLOCKED";
    log.referenceReviewDeleteBlocked = u2.error?.message ?? "NOT BLOCKED";

    console.log("SUPABASE VERIFICATION SMOKE", JSON.stringify(log, null, 2));
    if (process.env.POLLTRACE_SMOKE_OUT) (await import("node:fs")).writeFileSync(process.env.POLLTRACE_SMOKE_OUT, JSON.stringify(log, null, 2));

    expect(log.statusBeforeReference).toBe("CORROBORATED");
    expect(log.unconfirmed).toEqual({ status: expect.not.stringMatching(/^REFERENCE_DISCREPANCY$/), differenceUnconfirmed: true });
    expect(log.selfReview).toBe(403);
    expect(log.final).toMatchObject({
      status: "REFERENCE_DISCREPANCY",
      independentSources: 2,
      differences: { PARTY_A: 0, PARTY_B: 60, PARTY_C: 0 },
      differenceUnconfirmed: false,
      synthetic: true,
      reference: { reviewState: "CONFIRMED", sourceVerified: true },
      containsContributorIds: false,
    });
    expect(log.referenceUpdateBlocked).not.toBe("NOT BLOCKED");
    expect(log.referenceReviewDeleteBlocked).not.toBe("NOT BLOCKED");
  });
});
