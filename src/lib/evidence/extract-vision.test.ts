/**
 * REAL_VISION extraction at the API layer (LOCAL_DEV). The provider is NEVER called: the
 * extraction runner is injected to simulate success, failures, slowness and refusals.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceTrace, ExtractResponse, ResultRevisionView } from "@/lib/contracts/trace";
import type { Principal } from "@/lib/auth/session";
import { ExtractionError, runExtraction, type ExtractionRun } from "@/lib/extraction";
import { findPollingUnit } from "@/lib/seed/registry";
import { createLocalStorage } from "@/lib/storage/local";
import type { ContributorRecord, EvidenceStorage } from "@/lib/storage";
import { createFixedWindowLimiter } from "./rate-limit";
import { sha256HexNode, submitEvidence } from "./service";
import {
  AI_CONFIRMED_SUMMARY,
  AI_SUGGESTED_SUMMARY,
  confirmEvidence,
  extractEvidence,
  getTrace,
  MAX_REAL_VISION_ATTEMPTS,
  reviewEvidence,
  type WorkflowDeps,
} from "./workflow";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 7, 8, 9]);
const VISION_ENV = { VISION_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real" };

const mk = (id: string, role: ContributorRecord["role"], alias: string, synthetic = false): ContributorRecord => ({
  id,
  role,
  alias,
  synthetic,
  assurance: "UNVERIFIED",
  createdAt: "2026-11-20T00:00:00.000Z",
});
const PEOPLE = {
  owner: mk("11111111-1111-4111-8111-111111111111", "CONTRIBUTOR", "Owner"),
  other: mk("22222222-2222-4222-8222-222222222222", "CONTRIBUTOR", "Other"),
  rev: mk("de000000-0000-4000-8000-00000000b002", "REVIEWER", "Synthetic Demo Reviewer B", true),
};
const P = (c: ContributorRecord): Principal => ({ contributorId: c.id, role: c.role, alias: c.alias, synthetic: c.synthetic });
const owner = P(PEOPLE.owner);
const other = P(PEOPLE.other);
const rev = P(PEOPLE.rev);

let dir: string;
let storage: EvidenceStorage;
let clock: number;
let extractor: ReturnType<typeof vi.fn<typeof runExtraction>>;
const deps = (): WorkflowDeps => ({
  storage,
  rateLimiter: createFixedWindowLimiter(10_000, 60_000),
  now: () => new Date((clock += 1000)),
  extractionEnv: VISION_ENV,
  extractor,
});

const visionRun = (over: Partial<ExtractionRun> = {}): ExtractionRun => ({
  draft: {
    formType: "EC8A",
    pollingUnitCode: findPollingUnit("demo-pu-012")!.code,
    entries: [
      { partyCode: "PARTY_A", votes: 145, needsReview: false },
      { partyCode: "PARTY_B", votes: null, needsReview: true },
      { partyCode: "PARTY_C", votes: 42, needsReview: false },
    ],
    accreditedVoters: null,
    rejectedVotes: null,
    validVotes: null,
    warnings: ["Some figures could not be read."],
    mode: "REAL_VISION",
  },
  modeUsed: "REAL_VISION",
  availableModes: ["REAL_VISION", "DEMO_FIXTURE", "MANUAL"],
  notice: "Automatic reading: check every figure against the photo.",
  uncertainFields: ["PARTY_B", "validVotes"],
  provenance: { provider: "anthropic", model: "claude-test-model", extractedAt: "2026-11-20T10:00:00.000Z", durationMs: 4200 },
  rawModelOutput: {
    modelOutput: { documentKind: "RESULT_SHEET", notes: ["PARTY_B smudged"] },
    analysisCopy: { width: 1600, height: 1200, mime: "image/jpeg" },
    requestedModel: "claude-test-model",
    servedModel: "claude-test-model",
    headers: { "x-api-key": "sk-should-never-persist" },
    apiKey: "sk-should-never-persist",
  },
  ...over,
});

async function upload(p: Principal = owner): Promise<string> {
  const r = await submitEvidence(
    {
      principal: p,
      file: JPEG,
      fields: { electionId: "demo-election", pollingUnitId: "demo-pu-012", clientSubmissionId: crypto.randomUUID(), originalSha256: sha256HexNode(JPEG) },
    },
    deps(),
  );
  expect(r.status).toBe(201);
  return (r.body as { id: string }).id;
}
const extract = (p: Principal | null, id: string, mode = "REAL_VISION") => extractEvidence(p, id, { mode }, deps());
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;
const auditTypes = async (id: string) => (await storage.repo.listAudit(id)).map((a) => a.eventType);
const confirmBody = (basedOnRevision: number) => ({
  basedOnRevision,
  formType: "EC8A",
  pollingUnitCodeOnSheet: findPollingUnit("demo-pu-012")!.code,
  entries: [
    { partyCode: "PARTY_A", votes: 145, needsReview: false },
    { partyCode: "PARTY_B", votes: 210, needsReview: false },
    { partyCode: "PARTY_C", votes: 42, needsReview: false },
  ],
  accreditedVoters: null,
  rejectedVotes: null,
  validVotes: 397,
});

const savedSecret = process.env.POLLTRACE_SESSION_SECRET;
beforeAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = "vision-test-secret-vision-test-secret-01";
});
afterAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = savedSecret;
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-vision-"));
  storage = createLocalStorage(dir);
  clock = Date.parse("2026-11-20T12:00:00.000Z");
  extractor = vi.fn<typeof runExtraction>(async () => visionRun());
  for (const c of Object.values(PEOPLE)) await storage.repo.ensureContributor(c);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("11 unauthorized extraction", () => {
  it.each([
    ["no session", null, 401, "UNAUTHENTICATED"],
    ["other contributor", other, 404, "NOT_FOUND"],
    ["reviewer", rev, 403, "OWNER_ONLY"],
  ] as const)("%s -> %i %s; provider never called, nothing recorded", async (_n, p, status, c) => {
    const id = await upload();
    const r = await extract(p, id);
    expect(r.status).toBe(status);
    expect(code(r)).toBe(c);
    expect(extractor).not.toHaveBeenCalled();
    expect(await auditTypes(id)).toEqual(["EVIDENCE_RECEIVED"]);
    expect(await storage.repo.listRevisions([id])).toHaveLength(0);
  });
});

describe("REAL_VISION success", () => {
  it("stores provenance + uncertain fields; raw output kept without secrets; trace wording exact", async () => {
    const id = await upload();
    const r = await extract(owner, id);
    expect(r.status).toBe(201);
    const body = r.body as ExtractResponse;
    expect(body.modeUsed).toBe("REAL_VISION");
    expect(body.revision).toMatchObject({
      origin: "REAL_VISION",
      extractionMode: "REAL_VISION",
      humanConfirmed: false,
      uncertainFields: ["PARTY_B", "validVotes"],
      provenance: { provider: "anthropic", model: "claude-test-model", extractedAt: "2026-11-20T10:00:00.000Z", durationMs: 4200 },
    });
    // The extractor received the PRIVATE original bytes, read server-side.
    expect(sha256HexNode(extractor.mock.calls[0][0].bytes)).toBe(sha256HexNode(JPEG));

    const disk = await readFile(path.join(dir, "polltrace-db.json"), "utf8");
    expect(disk).not.toContain("sk-should-never-persist");
    const raw = (await storage.repo.listRevisions([id]))[0].rawExtraction as Record<string, unknown>;
    expect(raw).toMatchObject({ provider: "anthropic", model: "claude-test-model", durationMs: 4200, uncertainFields: ["PARTY_B", "validVotes"] });
    expect((raw.modelOutput as Record<string, unknown>).analysisCopy).toEqual({ width: 1600, height: 1200, mime: "image/jpeg" });
    expect(await auditTypes(id)).toEqual(["EVIDENCE_RECEIVED", "EXTRACTION_STARTED", "EXTRACTION_CREATED"]);

    const t = (await getTrace(owner, id, deps())).body as EvidenceTrace;
    expect(t.timeline.find((e) => e.type === "EXTRACTION")?.summary).toBe(AI_SUGGESTED_SUMMARY);
    expect(t.permissions.availableExtractionModes).toEqual(["REAL_VISION", "DEMO_FIXTURE", "MANUAL"]);
  });

  it("trace offers REAL_VISION only when configured", async () => {
    const id = await upload();
    const t = (await getTrace(owner, id, { ...deps(), extractionEnv: {} })).body as EvidenceTrace;
    expect(t.permissions.availableExtractionModes).not.toContain("REAL_VISION");
    const half = (await getTrace(owner, id, { ...deps(), extractionEnv: { VISION_PROVIDER: "anthropic" } })).body as EvidenceTrace;
    expect(half.permissions.availableExtractionModes).not.toContain("REAL_VISION");
  });
});

describe("failure mapping (original, revisions and status untouched; EXTRACTION_FAILED audited)", () => {
  it.each([
    ["MODE_UNAVAILABLE", 422, "MODE_UNAVAILABLE"],
    ["NOT_CONFIGURED", 422, "MODE_UNAVAILABLE"],
    ["UNSUPPORTED_DOCUMENT", 422, "EXTRACTION_UNSUPPORTED_DOCUMENT"],
    ["INVALID_DRAFT", 502, "EXTRACTION_REJECTED"],
    ["REFUSED", 502, "EXTRACTION_REJECTED"],
    ["PROVIDER_ERROR", 502, "EXTRACTION_REJECTED"],
    ["PROVIDER_TIMEOUT", 504, "EXTRACTION_TIMEOUT"],
  ] as const)("%s -> %i %s", async (errCode, status, apiCode) => {
    const id = await upload();
    const before = await storage.repo.getEvidence(id);
    extractor.mockImplementation(async () => {
      throw new ExtractionError(errCode, "provider said no", ["Looks like a <b>receipt</b>\u0000", "x".repeat(1000)]);
    });
    const r = await extract(owner, id);
    expect(r.status).toBe(status);
    expect(code(r)).toBe(apiCode);
    if (apiCode === "EXTRACTION_UNSUPPORTED_DOCUMENT") {
      const notes = (r.body as { error: { notes: string[] } }).error.notes;
      expect(notes[0]).not.toContain("\u0000");
      expect(notes[1].length).toBeLessThanOrEqual(300);
    }
    expect(await storage.repo.listRevisions([id])).toHaveLength(0);
    expect(await storage.repo.getEvidence(id)).toEqual(before);
    expect(sha256HexNode((await storage.objects.get(before!.originalPath))!)).toBe(sha256HexNode(JPEG));
    const failed = (await storage.repo.listAudit(id)).find((a) => a.eventType === "EXTRACTION_FAILED");
    expect(failed?.metadata).toMatchObject({ mode: "REAL_VISION", provider: "anthropic", code: errCode });
    expect(typeof failed?.metadata.durationMs).toBe("number");
  });

  it("unexpected (non-extraction) error -> 500 path, still audited as FAILED", async () => {
    const id = await upload();
    extractor.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(extract(owner, id)).rejects.toThrow("boom");
    expect(await auditTypes(id)).toContain("EXTRACTION_FAILED");
  });
});

describe("12 duplicate / concurrent extraction and per-evidence cap", () => {
  it("second REAL_VISION request while the first is in flight -> 409; first completes; then allowed", async () => {
    const id = await upload();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    extractor.mockImplementationOnce(async () => {
      await gate;
      return visionRun();
    });
    const first = extract(owner, id);
    await vi.waitFor(async () => expect(await auditTypes(id)).toContain("EXTRACTION_STARTED"));
    const second = await extract(owner, id);
    expect(second.status).toBe(409);
    expect(code(second)).toBe("EXTRACTION_IN_PROGRESS");
    release();
    expect((await first).status).toBe(201);
    expect((await extract(owner, id)).status).toBe(201);
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it("an attempt that never closed stops blocking after 90 s", async () => {
    const id = await upload();
    await storage.repo.appendAudit({
      id: crypto.randomUUID(),
      evidenceId: id,
      actorId: owner.contributorId,
      eventType: "EXTRACTION_STARTED",
      metadata: { attemptId: "crashed", mode: "REAL_VISION" },
      createdAt: new Date(clock).toISOString(),
    });
    expect(code(await extract(owner, id))).toBe("EXTRACTION_IN_PROGRESS");
    clock += 91_000;
    expect((await extract(owner, id)).status).toBe(201);
  });

  it(`cap: ${MAX_REAL_VISION_ATTEMPTS} REAL_VISION attempts (success or failure) -> 429; MANUAL still works`, async () => {
    const id = await upload();
    extractor.mockImplementationOnce(async () => {
      throw new ExtractionError("PROVIDER_TIMEOUT", "slow");
    });
    expect((await extract(owner, id)).status).toBe(504);
    expect((await extract(owner, id)).status).toBe(201);
    expect((await extract(owner, id)).status).toBe(201);
    const capped = await extract(owner, id);
    expect(capped.status).toBe(429);
    expect(code(capped)).toBe("EXTRACTION_LIMIT_REACHED");
    expect(extractor).toHaveBeenCalledTimes(3);
    extractor.mockImplementation((input, mode) => runExtraction(input, mode, {}));
    expect((await extract(owner, id, "MANUAL")).status).toBe(201);
  });
});

describe("13 human correction after a REAL_VISION draft", () => {
  it("HUMAN_CORRECTION revision; AI revision unchanged with provenance intact; trace wording exact", async () => {
    const id = await upload();
    expect((await extract(owner, id)).status).toBe(201);
    const aiBefore = structuredClone((await storage.repo.listRevisions([id]))[0]);
    const c = await confirmEvidence(owner, id, confirmBody(1), deps());
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ origin: "HUMAN_CORRECTION", humanConfirmed: true, basedOnRevision: 1, provenance: null, uncertainFields: [] });
    const revs = await storage.repo.listRevisions([id]);
    expect(revs[0]).toEqual(aiBefore);
    const t = (await getTrace(owner, id, deps())).body as EvidenceTrace;
    const [ai, human] = t.revisions as ResultRevisionView[];
    expect(ai.provenance).toEqual({ provider: "anthropic", model: "claude-test-model", extractedAt: "2026-11-20T10:00:00.000Z", durationMs: 4200 });
    expect(ai.uncertainFields).toEqual(["PARTY_B", "validVotes"]);
    expect(human.provenance).toBeNull();
    const ex = t.timeline.filter((e) => e.type === "EXTRACTION" || e.type === "HUMAN_CONFIRMATION").map((e) => e.summary);
    expect(ex).toEqual([AI_SUGGESTED_SUMMARY, AI_CONFIRMED_SUMMARY]);
    for (const e of t.timeline) expect(e.summary).not.toMatch(/verif|accura|confiden|fraud|authentic/i);
    // A reviewer can then accept the human-confirmed figures.
    expect((await reviewEvidence(rev, id, { decision: "ACCEPTED", independenceStatus: "UNVERIFIED", reason: "checked against photo" }, deps())).status).toBe(201);
  });
});

describe("14 manual fallback after an AI failure", () => {
  it("failed REAL_VISION -> MANUAL extract works -> confirm", async () => {
    const id = await upload();
    extractor.mockImplementation(async (input, mode) => {
      if (mode === "REAL_VISION") throw new ExtractionError("UNSUPPORTED_DOCUMENT", "Not a result sheet.", ["receipt"]);
      return runExtraction(input, mode, {});
    });
    const ai = await extract(owner, id);
    expect(ai.status).toBe(422);
    const manual = await extract(owner, id, "MANUAL");
    expect(manual.status).toBe(201);
    expect((manual.body as ExtractResponse).revision).toMatchObject({ revisionNumber: 1, origin: "MANUAL", provenance: null });
    expect((await confirmEvidence(owner, id, confirmBody(1), deps())).status).toBe(201);
    expect(await auditTypes(id)).toEqual(["EVIDENCE_RECEIVED", "EXTRACTION_STARTED", "EXTRACTION_FAILED", "EXTRACTION_CREATED", "HUMAN_CONFIRMED"]);
  });
});
