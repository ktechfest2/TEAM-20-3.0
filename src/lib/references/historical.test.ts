/**
 * REAL 2023 historical sample: import, per-election rosters, upload integrity rules and the
 * public comparison for a historical unit (LOCAL_DEV). Not INEC-certified; reference-only.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceView, UnitVerification } from "@/lib/contracts/verification";
import type { Principal } from "@/lib/auth/session";
import { signToken } from "@/lib/auth/tokens";
import { runExtraction } from "@/lib/extraction";
import { createFixedWindowLimiter, resetIpLimitersForTests } from "@/lib/evidence/rate-limit";
import { sha256HexNode, submitEvidence } from "@/lib/evidence/service";
import { finalizeUpload, initUpload, stagingKeyFor, type UploadIntent } from "@/lib/evidence/uploads";
import { confirmEvidence, extractEvidence, type WorkflowDeps } from "@/lib/evidence/workflow";
import { NG2023_ELECTION_ID, NG2023_PARTY_ROSTER, NG2023_SOURCE, NG2023_UNITS } from "@/lib/seed/historical-ng2023";
import { ELECTIONS } from "@/lib/seed/registry";
import { createLocalStorage } from "@/lib/storage/local";
import { getStorage, resetStorageForTests, type EvidenceStorage } from "@/lib/storage";
import { GET as verificationRoute } from "@/app/api/units/[id]/verification/route";
import { buildRows } from "../../../supabase/admin/import-ng2023.mjs";
import { loadNg2023 } from "../../../supabase/admin/ng2023-data.mjs";
import { HISTORICAL_IMPORTER, importHistoricalNg2023, ng2023AuditMetadata, ng2023Figures, ng2023ReferenceDescription } from "./historical";
import { getUnitVerification, importReference, listUnitReferences } from "./service";

const UNIT = NG2023_UNITS[0];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 3, 1, 4]);
const contributor: Principal = { contributorId: "11111111-1111-4111-8111-111111111111", role: "CONTRIBUTOR", alias: "Anon", synthetic: false };
const revA: Principal = { contributorId: "de000000-0000-4000-8000-00000000a001", role: "REVIEWER", alias: "Synthetic Demo Reviewer A", synthetic: true };

let dir: string;
let storage: EvidenceStorage;
const deps = (over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({ storage, rateLimiter: createFixedWindowLimiter(100_000, 60_000), ...over });
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;

const savedEnv = { ...process.env };
beforeAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = "historical-test-secret-historical-test-01";
});
afterAll(() => {
  process.env = savedEnv;
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-ng23-"));
  storage = createLocalStorage(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("historical import", () => {
  it("is idempotent: twice -> 130 references and 130 audit rows, not 260; never fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await importHistoricalNg2023(storage)).toEqual({ created: 130, skipped: 0, total: 130 });
    expect(await importHistoricalNg2023(storage)).toEqual({ created: 0, skipped: 130, total: 130 });
    expect(fetchSpy).not.toHaveBeenCalled();
    let refs = 0;
    for (const u of NG2023_UNITS) refs += (await storage.repo.listReferences(NG2023_ELECTION_ID, u.id)).length;
    expect(refs).toBe(130);
    expect(await storage.repo.getContributor(HISTORICAL_IMPORTER.id)).toMatchObject({ alias: "PollTrace historical data import", role: "REVIEWER", synthetic: false });
  });

  it("stores HISTORICAL_DATASET v1, real (not synthetic), unreviewed, with plain provenance text", async () => {
    await importHistoricalNg2023(storage);
    const [ref] = await storage.repo.listReferences(NG2023_ELECTION_ID, UNIT.id);
    expect(ref).toMatchObject({
      version: 1,
      sourceType: "HISTORICAL_DATASET",
      synthetic: false,
      sourceUrl: NG2023_SOURCE.url,
      createdBy: HISTORICAL_IMPORTER.id,
      figures: { APC: 112, LP: 12, PDP: 65, NNPP: 1 },
    });
    expect(ref.sourceDescription).toBe(
      "Nigeria 2.0 independent crosscheck of 2023 presidential result sheets — FCT_crosschecked.csv (sha256 6734fc9b…), retrieved 2026-11-20. " +
        "Accredited voters 191, registered 750. Sheet flags as published: stamped FALSE, corrected FALSE, invalid FALSE, unclear FALSE, unsigned UNKNOWN. " +
        "Not INEC-certified; provenance not reviewed by PollTrace reviewers.",
    );
    const list = (await listUnitReferences(revA, UNIT.id, null, deps())).body as ReferenceView[];
    expect(list[0]).toMatchObject({ reviewState: "NOT_REVIEWED", sourceVerified: false, synthetic: false, importedByViewer: false });
  });

  it("Supabase runner + 0008 SQL stay in sync with the app registry and the service", () => {
    const repo = path.resolve(__dirname, "../../..");
    const data = loadNg2023(repo);
    expect(data.units).toEqual(NG2023_UNITS);
    expect(data.source).toEqual(NG2023_SOURCE);
    expect(data.roster).toEqual([...NG2023_PARTY_ROSTER]);
    expect(data.election).toEqual(ELECTIONS.find((e) => e.id === NG2023_ELECTION_ID));
    for (const u of NG2023_UNITS) {
      const { reference, audit } = buildRows(u, data, "ref-id", "2026-11-20T00:00:00.000Z");
      expect(reference.source_description).toBe(ng2023ReferenceDescription(u));
      expect(reference.figures).toEqual(ng2023Figures(u));
      expect(reference).toMatchObject({ source_type: "HISTORICAL_DATASET", version: 1, synthetic: false, source_verified: false, created_by: HISTORICAL_IMPORTER.id });
      expect(audit.metadata).toEqual(ng2023AuditMetadata("ref-id", u));
    }
    const sql = readFileSync(path.join(repo, "supabase/migrations/0008_seed_ng2023_sample.sql"), "utf8");
    for (const u of NG2023_UNITS) expect(sql).toContain(`('${u.id}', 'NIGERIA2_2023_CROSSCHECK', '${u.code}'`);
    expect(sql).toContain(`'${NG2023_ELECTION_ID}'`);
    expect(sql).not.toMatch(/synthetic\)?\s*values[\s\S]*, true\)/);
  });
});

describe("public comparison for a historical unit", () => {
  it("NO_EVIDENCE with the reference and differences (witness null); real data, not synthetic", async () => {
    await importHistoricalNg2023(storage);
    const r = await getUnitVerification(UNIT.id, null, deps());
    expect(r.status).toBe(200);
    const v = r.body as UnitVerification;
    expect(v).toMatchObject({ electionId: NG2023_ELECTION_ID, status: "NO_EVIDENCE", synthetic: false, members: [] });
    expect(v.reference).toMatchObject({ sourceType: "HISTORICAL_DATASET", sourceVerified: false, reviewState: "NOT_REVIEWED", synthetic: false });
    expect(v.differences.map((d) => d.partyCode)).toEqual([...NG2023_PARTY_ROSTER]);
    for (const d of v.differences) expect(d).toMatchObject({ witness: null, referenceMinusWitness: null });
    expect(v.differences.find((d) => d.partyCode === "APC")?.reference).toBe(112);
    expect(JSON.stringify(v.reasons)).not.toMatch(/PARTY_|fraud|verified/i);
  });

  it("LOCAL_DEV auto-seeds on first storage use; route serves it without electionId", async () => {
    process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
    process.env.POLLTRACE_SEED_HISTORICAL = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetStorageForTests();
    resetIpLimitersForTests();
    try {
      const res = await verificationRoute(new Request(`http://x/api/units/${UNIT.id}/verification`), { params: Promise.resolve({ id: UNIT.id }) });
      expect(res.status).toBe(200);
      const v = await res.json();
      expect(v.reference.sourceType).toBe("HISTORICAL_DATASET");
      expect(v.status).toBe("NO_EVIDENCE");
      await getStorage().ready;
      let refs = 0;
      for (const u of NG2023_UNITS) refs += (await getStorage().repo.listReferences(NG2023_ELECTION_ID, u.id)).length;
      expect(refs).toBe(130);
    } finally {
      delete process.env.POLLTRACE_SEED_HISTORICAL;
      resetStorageForTests();
    }
  });
});

describe("party roster per election", () => {
  const ref = (pollingUnitId: string, electionId: string, figures: Record<string, number>, synthetic: boolean) =>
    importReference(revA, { electionId, pollingUnitId, sourceType: synthetic ? "SYNTHETIC_DEMO" : "HISTORICAL_DATASET", sourceDescription: "roster test", figures, synthetic }, deps());
  it.each([
    ["historical unit, historical parties", UNIT.id, NG2023_ELECTION_ID, { APC: 1, LP: 2 }, false, 201, undefined],
    ["historical unit, demo parties", UNIT.id, NG2023_ELECTION_ID, { PARTY_A: 1 }, false, 400, "INVALID_FIGURES"],
    ["demo unit, historical parties", "demo-pu-012", "demo-election", { APC: 1 }, true, 400, "INVALID_FIGURES"],
    ["demo unit filed under historical election", "demo-pu-012", NG2023_ELECTION_ID, { APC: 1 }, true, 400, "UNIT_ELECTION_MISMATCH"],
    ["historical unit filed under demo election", UNIT.id, "demo-election", { PARTY_A: 1 }, true, 400, "UNIT_ELECTION_MISMATCH"],
  ] as const)("reference: %s -> %i %s", async (_n, unit, election, figures, synthetic, status, c) => {
    const r = await ref(unit, election, figures, synthetic);
    expect(r.status).toBe(status);
    if (c) expect(code(r)).toBe(c);
  });

  it("demo evidence: extraction gets the demo roster; confirm rejects historical party codes", async () => {
    await storage.repo.ensureContributor({ id: contributor.contributorId, alias: "Anon", role: "CONTRIBUTOR", assurance: "UNVERIFIED", synthetic: false, createdAt: new Date().toISOString() });
    const up = await submitEvidence(
      { principal: contributor, file: JPEG, fields: { electionId: "demo-election", pollingUnitId: "demo-pu-012", clientSubmissionId: crypto.randomUUID(), originalSha256: sha256HexNode(JPEG) } },
      deps(),
    );
    const id = (up.body as { id: string }).id;
    const extractor = vi.fn<typeof runExtraction>((input, mode) => runExtraction(input, mode, {}));
    expect((await extractEvidence(contributor, id, { mode: "MANUAL" }, deps({ extractor, extractionEnv: {} }))).status).toBe(201);
    expect(extractor.mock.calls[0][0].partyRoster).toEqual(["PARTY_A", "PARTY_B", "PARTY_C"]);
    const bad = await confirmEvidence(
      contributor,
      id,
      { basedOnRevision: 1, formType: "EC8A", pollingUnitCodeOnSheet: null, entries: [{ partyCode: "APC", votes: 1, needsReview: false }], accreditedVoters: null, rejectedVotes: null, validVotes: null },
      deps(),
    );
    expect(bad.status).toBe(400);
    expect(code(bad)).toBe("INVALID_FIGURES");
  });
});

describe("evidence uploads cannot target the historical sample or a mismatched unit", () => {
  const cases = [
    ["historical election + historical unit", NG2023_ELECTION_ID, UNIT.id, "HISTORICAL_ELECTION_READ_ONLY"],
    ["historical election + demo unit", NG2023_ELECTION_ID, "demo-pu-012", "HISTORICAL_ELECTION_READ_ONLY"],
    ["demo election + historical unit", "demo-election", UNIT.id, "UNIT_ELECTION_MISMATCH"],
  ] as const;

  it.each(cases)("multipart: %s -> 400 %s", async (_n, electionId, pollingUnitId, c) => {
    const r = await submitEvidence(
      { principal: contributor, file: JPEG, fields: { electionId, pollingUnitId, clientSubmissionId: crypto.randomUUID(), originalSha256: sha256HexNode(JPEG) } },
      deps(),
    );
    expect(r.status).toBe(400);
    expect(code(r)).toBe(c);
  });

  it.each(cases)("direct-upload init: %s -> 400 %s", async (_n, electionId, pollingUnitId, c) => {
    const r = await initUpload(
      contributor,
      { electionId, pollingUnitId, clientSubmissionId: crypto.randomUUID(), originalSha256: sha256HexNode(JPEG), sizeBytes: JPEG.byteLength, mime: "image/jpeg" },
      deps(),
    );
    expect(r.status).toBe(400);
    expect(code(r)).toBe(c);
  });

  it("finalize re-checks (intent signed before the rule existed) -> 400, staging removed, nothing stored", async () => {
    const csid = crypto.randomUUID();
    const key = stagingKeyFor(contributor.contributorId, csid);
    await storage.objects.putStaging(key, JPEG, "image/jpeg");
    const intentToken = signToken<UploadIntent>("pi1", {
      exp: Math.floor(Date.now() / 1000) + 600,
      cid: contributor.contributorId,
      csid,
      sha: sha256HexNode(JPEG),
      size: JPEG.byteLength,
      mime: "image/jpeg",
      eid: NG2023_ELECTION_ID,
      puid: UNIT.id,
      src: "WITNESS_PHOTO",
      cap: null,
      key,
    });
    const r = await finalizeUpload(contributor, { clientSubmissionId: csid, intentToken }, deps());
    expect(r.status).toBe(400);
    expect(code(r)).toBe("HISTORICAL_ELECTION_READ_ONLY");
    expect(await storage.repo.findEvidenceBySubmission(contributor.contributorId, csid)).toBeNull();
    expect(await storage.objects.get(key)).toBeNull();
  });
});
