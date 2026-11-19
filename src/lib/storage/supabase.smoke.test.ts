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
      pollingUnitId: "demo-pu-012",
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
        fields: { electionId: "demo-election", pollingUnitId: "demo-pu-012", clientSubmissionId: csidC, originalSha256: sha256HexNode(bytesC), sourceType: "WITNESS_PHOTO" },
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
