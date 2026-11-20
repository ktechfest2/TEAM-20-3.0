import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResultRevisionView, EvidenceTrace, ReviewQueueResponse } from "@/lib/contracts/trace";
import type { Principal } from "@/lib/auth/session";
import { createLocalStorage } from "@/lib/storage/local";
import type { ContributorRecord, EvidenceStorage } from "@/lib/storage";
import { createFixedWindowLimiter } from "./rate-limit";
import { sha256HexNode, submitEvidence, type ServiceResult } from "./service";
import { finalizeUpload, initUpload } from "./uploads";
import { deriveEvidenceStatus } from "./views";
import { findPollingUnit } from "@/lib/seed/registry";

/** Read from the registry (sample codes/names can be relabelled without breaking tests). */
const UNIT_012 = findPollingUnit("demo-pu-012")!;
const OTHER_CODE = `${UNIT_012.code}9`; // a different unit code
import { confirmEvidence, extractEvidence, getReviewQueue, getTrace, reviewEvidence, type WorkflowDeps } from "./workflow";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);
const JPEG2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 4, 5, 6]);

const person = (id: string, role: ContributorRecord["role"], alias: string, synthetic = false): ContributorRecord => ({
  id,
  alias,
  role,
  assurance: "UNVERIFIED",
  synthetic,
  createdAt: "2026-11-19T00:00:00.000Z",
});
const PEOPLE = {
  alice: person("11111111-1111-4111-8111-111111111111", "CONTRIBUTOR", "Anon A"),
  bob: person("22222222-2222-4222-8222-222222222222", "CONTRIBUTOR", "Anon B"),
  revA: person("de000000-0000-4000-8000-00000000a001", "REVIEWER", "Synthetic Demo Reviewer A", true),
  revB: person("de000000-0000-4000-8000-00000000b002", "REVIEWER", "Synthetic Demo Reviewer B", true),
};
const P = (c: ContributorRecord): Principal => ({ contributorId: c.id, role: c.role, alias: c.alias, synthetic: c.synthetic });
const alice = P(PEOPLE.alice);
const bob = P(PEOPLE.bob);
const revA = P(PEOPLE.revA);
const revB = P(PEOPLE.revB);
/** Reviewer sessions cannot upload (403 REVIEWER_SESSION). Self-review fixtures model a person who
 *  uploaded as a contributor and was later given the reviewer role (same contributor id). */
const revAAsContributor: Principal = { ...revA, role: "CONTRIBUTOR" };

let dir: string;
let storage: EvidenceStorage;
let clock: number;
const deps = (): WorkflowDeps => ({
  storage,
  rateLimiter: createFixedWindowLimiter(10_000, 60_000),
  now: () => new Date((clock += 1000)),
  extractionEnv: {},
});

async function upload(p: Principal, bytes = JPEG, capturedAtClaimed = "2026-11-19T13:00:00.000Z"): Promise<string> {
  const r = await submitEvidence(
    {
      principal: p,
      file: bytes,
      fields: {
        electionId: "demo-election",
        pollingUnitId: "demo-pu-012",
        clientSubmissionId: crypto.randomUUID(),
        originalSha256: sha256HexNode(bytes),
        capturedAtClaimed,
      },
    },
    deps(),
  );
  expect(r.status).toBe(201);
  return (r.body as { id: string }).id;
}

const confirmBody = (basedOnRevision: number, over: Record<string, unknown> = {}) => ({
  basedOnRevision,
  formType: "EC8A",
  pollingUnitCodeOnSheet: UNIT_012.code,
  entries: [
    { partyCode: "PARTY_A", votes: 145, needsReview: false },
    { partyCode: "PARTY_B", votes: 210, needsReview: false },
    { partyCode: "PARTY_C", votes: 42, needsReview: false },
  ],
  accreditedVoters: null,
  rejectedVotes: null,
  validVotes: 397,
  ...over,
});
const review = (decision: string, independenceStatus = "UNVERIFIED") => ({ decision, independenceStatus, reason: `Checked: ${decision}` });
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;
const statusOf = async (id: string) => (await storage.repo.getEvidence(id))!.status;
const extract = (p: Principal, id: string, mode = "AUTO") => extractEvidence(p, id, { mode }, deps());
const confirm = (p: Principal, id: string, body: unknown) => confirmEvidence(p, id, body, deps());
const trace = async (p: Principal, id: string) => (await getTrace(p, id, deps())).body as EvidenceTrace;

const savedSecret = process.env.POLLTRACE_SESSION_SECRET;
beforeAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = "workflow-test-secret-workflow-test-secret";
});
afterAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = savedSecret;
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-wf-"));
  storage = createLocalStorage(dir);
  clock = Date.parse("2026-11-19T15:00:00.000Z");
  for (const c of Object.values(PEOPLE)) await storage.repo.ensureContributor(c);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

/* ------------------------------------------------------------------ ACL matrix */

type Op = "queue" | "review" | "extract" | "confirm" | "trace";
type Actor = "none" | "otherContributor" | "owner" | "reviewer" | "selfReviewer";

/** E1 is Alice's; E2 was uploaded by reviewer A's id while it was a contributor ("selfReviewer"). */
const ACTORS: Record<Actor, { principal: Principal | null; evidence: "E1" | "E2" }> = {
  none: { principal: null, evidence: "E1" },
  otherContributor: { principal: bob, evidence: "E1" },
  owner: { principal: alice, evidence: "E1" },
  reviewer: { principal: revB, evidence: "E1" },
  selfReviewer: { principal: revA, evidence: "E2" },
};

const MATRIX: Array<[Op, Actor, number, string?]> = [
  ["queue", "none", 401, "UNAUTHENTICATED"],
  ["queue", "otherContributor", 403, "REVIEWER_ONLY"],
  ["queue", "owner", 403, "REVIEWER_ONLY"],
  ["queue", "reviewer", 200],
  ["queue", "selfReviewer", 200],
  ["review", "none", 401, "UNAUTHENTICATED"],
  ["review", "otherContributor", 403, "REVIEWER_ONLY"],
  ["review", "owner", 403, "REVIEWER_ONLY"],
  ["review", "reviewer", 201],
  ["review", "selfReviewer", 403, "SELF_REVIEW"],
  ["extract", "none", 401, "UNAUTHENTICATED"],
  ["extract", "otherContributor", 404, "NOT_FOUND"],
  ["extract", "owner", 201],
  ["extract", "reviewer", 403, "OWNER_ONLY"],
  ["extract", "selfReviewer", 201],
  ["confirm", "none", 401, "UNAUTHENTICATED"],
  ["confirm", "otherContributor", 404, "NOT_FOUND"],
  ["confirm", "owner", 201],
  ["confirm", "reviewer", 403, "OWNER_ONLY"],
  ["confirm", "selfReviewer", 201], // uploader of E2 is its owner
  ["trace", "none", 401, "UNAUTHENTICATED"],
  ["trace", "otherContributor", 404, "NOT_FOUND"],
  ["trace", "owner", 200],
  ["trace", "reviewer", 200],
  ["trace", "selfReviewer", 200],
];

describe("ACL matrix", () => {
  it.each(MATRIX)("%s as %s -> %i %s", async (op, actor, status, errCode) => {
    const ids = { E1: await upload(alice), E2: await upload(revAAsContributor, JPEG2) };
    for (const [id, owner] of [[ids.E1, alice], [ids.E2, revAAsContributor]] as const) expect((await extract(owner, id)).status).toBe(201);

    const { principal, evidence } = ACTORS[actor];
    const id = ids[evidence];
    const r =
      op === "queue"
        ? await getReviewQueue(principal, deps())
        : op === "review"
          ? await reviewEvidence(principal, id, review("FLAGGED"), deps())
          : op === "extract"
            ? await extractEvidence(principal, id, { mode: "AUTO" }, deps())
            : op === "confirm"
              ? await confirmEvidence(principal, id, confirmBody(1), deps())
              : await getTrace(principal, id, deps());
    expect(r.status).toBe(status);
    if (errCode) expect(code(r)).toBe(errCode);
  });

  it("unknown or malformed evidence id -> 404 for a reviewer", async () => {
    expect((await reviewEvidence(revB, crypto.randomUUID(), review("FLAGGED"), deps())).status).toBe(404);
    expect((await getTrace(revB, "not-a-uuid", deps())).status).toBe(404);
  });

  it("trace permissions per viewer", async () => {
    const e1 = await upload(alice);
    const e2 = await upload(revAAsContributor, JPEG2);
    expect((await trace(alice, e1)).permissions).toEqual({
      canExtract: true,
      canConfirm: true,
      canReview: false,
      reviewBlockedReason: "Only reviewers can record a decision.",
      availableExtractionModes: ["DEMO_FIXTURE", "MANUAL"],
    });
    expect((await trace(revB, e1)).permissions).toEqual({
      canExtract: false,
      canConfirm: false,
      canReview: true,
      reviewBlockedReason: null,
      availableExtractionModes: ["DEMO_FIXTURE", "MANUAL"],
    });
    expect((await trace(revA, e2)).permissions).toEqual({
      canExtract: true,
      canConfirm: true,
      canReview: false,
      reviewBlockedReason: "You submitted this evidence.",
      availableExtractionModes: ["DEMO_FIXTURE", "MANUAL"],
    });
    expect((await trace(revB, e1)).originalUrl).toBe(`/api/evidence/${e1}/original`);
  });
});

/* ------------------------------------------------------------------ review transitions */

describe("reviewer sessions cannot submit evidence", () => {
  it.each([
    ["multipart", (): Promise<ServiceResult> => submitEvidence({ principal: revA, file: JPEG, fields: {} }, deps())],
    ["upload init", (): Promise<ServiceResult> => initUpload(revA, {}, deps())],
    ["upload finalize", (): Promise<ServiceResult> => finalizeUpload(revA, {}, deps())],
  ] as const)("%s -> 403 REVIEWER_SESSION, nothing stored", async (_n, run) => {
    const r = await run();
    expect(r.status).toBe(403);
    expect(code(r)).toBe("REVIEWER_SESSION");
    expect(await storage.repo.listEvidenceByStatus(["RECEIVED"], 10)).toHaveLength(0);
  });
});

describe("review decisions", () => {
  it.each([
    ["FLAGGED", "PENDING_REVIEW", false],
    ["REJECTED", "REJECTED", false],
    ["ACCEPTED", "ACCEPTED", true],
  ] as const)("%s -> status %s", async (decision, expected, needsConfirm) => {
    const id = await upload(alice);
    if (needsConfirm) {
      await extract(alice, id);
      expect((await confirm(alice, id, confirmBody(1))).status).toBe(201);
    }
    const r = await reviewEvidence(revB, id, review(decision, "REVIEWER_CONFIRMED"), deps());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: expected, review: { decision, byViewer: true, synthetic: true } });
    expect((r.body as { review: { reviewerRef: string } }).review.reviewerRef).toMatch(/^[0-9a-f]{12}$/);
    expect(await statusOf(id)).toBe(expected);
  });

  it.each([
    ["no revisions", async (): Promise<void> => {}],
    ["only a machine draft", async (id: string): Promise<void> => void (await extract(alice, id))],
    [
      "confirmed then a newer machine draft",
      async (id: string): Promise<void> => {
        await extract(alice, id);
        await confirm(alice, id, confirmBody(1));
        await extract(alice, id);
      },
    ],
  ] as const)("ACCEPTED with %s -> 409 NO_CONFIRMED_REVISION", async (_n, setup) => {
    const id = await upload(alice);
    await setup(id);
    const r = await reviewEvidence(revB, id, review("ACCEPTED"), deps());
    expect(r.status).toBe(409);
    expect(code(r)).toBe("NO_CONFIRMED_REVISION");
    expect((await storage.repo.listReviews([id])).length).toBe(0);
  });

  it.each([
    ["different unit on the sheet", OTHER_CODE, "ACCEPTED", 409, "PU_CODE_MISMATCH"],
    ["different unit, FLAGGED allowed", OTHER_CODE, "FLAGGED", 201, undefined],
    ["different unit, REJECTED allowed", OTHER_CODE, "REJECTED", 201, undefined],
    ["same code, other punctuation", UNIT_012.code.replace(/[-.]/g, " ").toLowerCase(), "ACCEPTED", 201, undefined],
    ["code unreadable (null)", null, "ACCEPTED", 201, undefined],
  ] as const)("PU code on sheet: %s -> %s %i", async (_n, sheetCode, decision, status, c) => {
    const id = await upload(alice);
    await extract(alice, id);
    expect((await confirm(alice, id, confirmBody(1, { pollingUnitCodeOnSheet: sheetCode }))).status).toBe(201);
    const r = await reviewEvidence(revB, id, review(decision), deps());
    expect(r.status).toBe(status);
    if (c) {
      expect(code(r)).toBe(c);
      expect(r.body).toMatchObject({ error: { sheetCode, registryCode: UNIT_012.code } });
      expect(await storage.repo.listReviews([id])).toHaveLength(0);
    }
  });

  it("later decisions append; latest wins; earlier events unchanged; audit per decision", async () => {
    const id = await upload(alice);
    await reviewEvidence(revB, id, review("FLAGGED"), deps());
    const before = structuredClone(await storage.repo.listReviews([id]));
    await reviewEvidence(revA, id, review("REJECTED", "DISPUTED"), deps());
    const after = await storage.repo.listReviews([id]);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect(await statusOf(id)).toBe("REJECTED");
    const audit = (await storage.repo.listAudit(id)).filter((a) => a.eventType === "REVIEW_RECORDED");
    expect(audit.map((a) => a.metadata.newStatus)).toEqual(["PENDING_REVIEW", "REJECTED"]);
  });

  it("reason under 3 chars -> 400", async () => {
    const id = await upload(alice);
    const r = await reviewEvidence(revB, id, { decision: "FLAGGED", independenceStatus: "UNVERIFIED", reason: "ok" }, deps());
    expect(r.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ extraction + confirmation */

describe("revisions", () => {
  it("extract AUTO on synthetic evidence -> DEMO_FIXTURE revision 1, not confirmed, audited", async () => {
    const id = await upload(alice);
    const r = await extract(alice, id);
    expect(r.status).toBe(201);
    const body = r.body as { revision: ResultRevisionView; modeUsed: string; notice: string; availableModes: string[] };
    expect(body.modeUsed).toBe("DEMO_FIXTURE");
    expect(body.notice).toMatch(/not read from this photo/);
    expect(body.notice).not.toMatch(/demo|synthetic/i);
    expect(body.revision).toMatchObject({ revisionNumber: 1, origin: "DEMO_FIXTURE", extractionMode: "DEMO_FIXTURE", humanConfirmed: false, basedOnRevision: null, createdByViewer: true });
    expect((await storage.repo.listAudit(id)).map((a) => a.eventType)).toContain("EXTRACTION_CREATED");
  });

  it("explicit unavailable mode -> 422 MODE_UNAVAILABLE, nothing stored", async () => {
    const id = await upload(alice);
    const r = await extract(alice, id, "REAL_VISION");
    expect(r.status).toBe(422);
    expect(code(r)).toBe("MODE_UNAVAILABLE");
    expect(await storage.repo.listRevisions([id])).toHaveLength(0);
  });

  it("concurrent extractions get distinct consecutive revision numbers", async () => {
    const id = await upload(alice);
    const rs = await Promise.all([1, 2, 3].map(() => extract(alice, id)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect((await storage.repo.listRevisions([id])).map((r) => r.revisionNumber)).toEqual([1, 2, 3]);
  });

  it("confirm creates HUMAN_CORRECTION, moves RECEIVED -> PENDING_REVIEW, never edits revision 1", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    const rev1Before = structuredClone((await storage.repo.listRevisions([id]))[0]);
    const r = await confirm(alice, id, confirmBody(1, { note: "PARTY_C smudged but legible" }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ revisionNumber: 2, origin: "HUMAN_CORRECTION", extractionMode: null, humanConfirmed: true, basedOnRevision: 1, note: "PARTY_C smudged but legible" });
    const revs = await storage.repo.listRevisions([id]);
    expect(revs[0]).toEqual(rev1Before);
    expect(await statusOf(id)).toBe("PENDING_REVIEW");
    // raw file on disk also still holds revision 1 unchanged
    const disk = JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8"));
    expect(disk.revisions[0]).toEqual(rev1Before);
  });

  it("unreadable (null) figures are accepted and stay needsReview", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    const r = await confirm(
      alice,
      id,
      confirmBody(1, {
        entries: [
          { partyCode: "PARTY_A", votes: 145, needsReview: false },
          { partyCode: "PARTY_B", votes: null, needsReview: false },
          { partyCode: "PARTY_C", votes: 42, needsReview: false },
        ],
      }),
    );
    expect(r.status).toBe(201);
    expect((r.body as ResultRevisionView).entries[1]).toEqual({ partyCode: "PARTY_B", votes: null, needsReview: true });
  });

  it.each([
    ["based on an old revision", 1, async (id: string): Promise<void> => void (await extract(alice, id))],
    ["no revision yet", 1, async (): Promise<void> => {}],
    ["revision number from the future", 9, async (): Promise<void> => {}],
  ] as const)("confirm %s -> 409 STALE_REVISION", async (_n, based, extraSetup) => {
    const id = await upload(alice);
    if (_n !== "no revision yet") await extract(alice, id);
    await extraSetup(id);
    const r = await confirm(alice, id, confirmBody(based));
    expect(r.status).toBe(409);
    expect(code(r)).toBe("STALE_REVISION");
  });

  it.each([
    ["unknown party", [{ partyCode: "PARTY_Z", votes: 1, needsReview: false }, { partyCode: "PARTY_A", votes: 1, needsReview: false }, { partyCode: "PARTY_B", votes: 1, needsReview: false }, { partyCode: "PARTY_C", votes: 1, needsReview: false }]],
    ["missing roster party", [{ partyCode: "PARTY_A", votes: 1, needsReview: false }, { partyCode: "PARTY_B", votes: 1, needsReview: false }]],
    ["duplicate party", [{ partyCode: "PARTY_A", votes: 1, needsReview: false }, { partyCode: "PARTY_A", votes: 2, needsReview: false }, { partyCode: "PARTY_B", votes: 1, needsReview: false }, { partyCode: "PARTY_C", votes: 1, needsReview: false }]],
  ])("confirm with %s -> 400 INVALID_FIGURES with issues", async (_n, entries) => {
    const id = await upload(alice);
    await extract(alice, id);
    const r = await confirm(alice, id, confirmBody(1, { entries }));
    expect(r.status).toBe(400);
    expect(code(r)).toBe("INVALID_FIGURES");
    expect((r.body as { error: { issues: string[] } }).error.issues.length).toBeGreaterThan(0);
    expect(await storage.repo.listRevisions([id])).toHaveLength(1);
  });

  it("confirm merges sheet-code + sum warnings, de-duplicated", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    const r = await confirm(alice, id, confirmBody(1, { pollingUnitCodeOnSheet: OTHER_CODE, validVotes: 400 }));
    expect(r.status).toBe(201);
    const w = (r.body as ResultRevisionView).warnings;
    expect(w.length).toBeGreaterThanOrEqual(2);
    expect(new Set(w).size).toBe(w.length);
    expect(w.some((x) => /397/.test(x) && /400/.test(x))).toBe(true);
  });

  it("new human revision after ACCEPTED returns status to PENDING_REVIEW (audited)", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    await confirm(alice, id, confirmBody(1));
    expect((await reviewEvidence(revB, id, review("ACCEPTED"), deps())).status).toBe(201);
    expect(await statusOf(id)).toBe("ACCEPTED");
    expect((await confirm(alice, id, confirmBody(2, { validVotes: 397 }))).status).toBe(201);
    expect(await statusOf(id)).toBe("PENDING_REVIEW");
    const audit = (await storage.repo.listAudit(id)).filter((a) => a.eventType === "HUMAN_CONFIRMED");
    expect(audit.at(-1)?.metadata).toMatchObject({ previousStatus: "ACCEPTED", newStatus: "PENDING_REVIEW", statusResetAfterReview: true });
  });
});

/* ------------------------------------------------------------------ queue + trace */

describe("queue and trace", () => {
  it("queue: oldest first, FLAGGED included, ACCEPTED/REJECTED excluded, submittedByViewer, duplicates", async () => {
    const e1 = await upload(alice); // oldest
    const e2 = await upload(bob); // identical bytes to e1 -> duplicates
    const e3 = await upload(revAAsContributor, JPEG2);
    const e4 = await upload(bob, JPEG2);
    await reviewEvidence(revB, e2, review("FLAGGED"), deps());
    await reviewEvidence(revB, e4, review("REJECTED"), deps());

    const q = (await getReviewQueue(revA, deps())).body as ReviewQueueResponse;
    expect(q.items.map((i) => i.id)).toEqual([e1, e2, e3]);
    expect(q.synthetic).toBe(true);
    const by = Object.fromEntries(q.items.map((i) => [i.id, i]));
    expect(by[e1]).toMatchObject({ exactDuplicateCount: 1, submittedByViewer: false, reviewCount: 0, lastDecision: null, pollingUnitCode: UNIT_012.code });
    expect(by[e2]).toMatchObject({ exactDuplicateCount: 1, status: "PENDING_REVIEW", lastDecision: "FLAGGED", reviewCount: 1 });
    expect(by[e3]).toMatchObject({ submittedByViewer: true, exactDuplicateCount: 1 }); // e4 shares JPEG2
  });

  it("trace: two contributors uploading identical bytes -> exactDuplicateCount 1 each", async () => {
    const e1 = await upload(alice);
    const e2 = await upload(bob);
    expect((await trace(alice, e1)).integrity).toEqual({ serverHashMatchedClient: true, exactDuplicateCount: 1 });
    expect((await trace(bob, e2)).integrity.exactDuplicateCount).toBe(1);
    expect((await trace(revB, e1)).integrity.exactDuplicateCount).toBe(1);
  });

  it("timeline order, plain wording, and no banned words", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    await confirm(alice, id, confirmBody(1));
    await reviewEvidence(revB, id, review("FLAGGED"), deps());
    await reviewEvidence(revA, id, review("ACCEPTED", "REVIEWER_CONFIRMED"), deps());

    const t = await trace(revB, id);
    expect(t.timeline.map((e) => e.type)).toEqual(["CAPTURE_CLAIMED", "RECEIVED", "EXTRACTION", "HUMAN_CONFIRMATION", "REVIEW", "REVIEW"]);
    const [claim, received, extraction, human] = t.timeline;
    expect(claim).toMatchObject({ claimOnly: true, at: "2026-11-19T13:00:00.000Z" });
    expect(claim.summary).toMatch(/^Phone clock says the photo was saved at 2026-11-19 13:00 UTC/);
    expect(received.summary).toBe("Server received the file and recomputed its fingerprint; it matched.");
    expect(extraction.summary).toMatch(/not read from this photo/);
    expect(extraction.ref).toBe("1");
    expect(human.summary).toMatch(/based on revision 1/);
    expect(t.timeline.slice(1).every((e) => !e.claimOnly)).toBe(true);
    for (const e of t.timeline) expect(e.summary).not.toMatch(/verif|fraud|authentic|rigg|fake/i);
    expect(t.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(t.reviews.map((r) => [r.decision, r.byViewer])).toEqual([["FLAGGED", true], ["ACCEPTED", false]]);
    expect(t.evidence).toMatchObject({ status: "ACCEPTED", synthetic: true, storageMode: "LOCAL_DEV", pollingUnitName: UNIT_012.name });
    const s = JSON.stringify(t);
    expect(s).not.toMatch(/originalPath|originals\/|contributorId|Anon A|Synthetic Demo Reviewer/);
  });

  it("no capture claim -> timeline starts at RECEIVED", async () => {
    const r = await submitEvidence(
      {
        principal: alice,
        file: JPEG,
        fields: { electionId: "demo-election", pollingUnitId: "demo-pu-012", clientSubmissionId: crypto.randomUUID(), originalSha256: sha256HexNode(JPEG) },
      },
      deps(),
    );
    const t = await trace(alice, (r.body as { id: string }).id);
    expect(t.timeline[0].type).toBe("RECEIVED");
  });
});

/* ------------------------------------------------------------------ derived status */

describe("status is derived from history (review events are the source of truth)", () => {
  const rev = (t: number, humanConfirmed: boolean) => ({ createdAt: new Date(t * 1000).toISOString(), humanConfirmed });
  const rv = (t: number, decision: "ACCEPTED" | "REJECTED" | "FLAGGED") => ({ createdAt: new Date(t * 1000).toISOString(), decision });
  it.each([
    ["nothing", [], [], "RECEIVED"],
    ["machine draft only", [rev(1, false)], [], "RECEIVED"],
    ["human confirmed", [rev(1, false), rev(2, true)], [], "PENDING_REVIEW"],
    ["rejected without revisions", [], [rv(1, "REJECTED")], "REJECTED"],
    ["flagged", [], [rv(1, "FLAGGED")], "PENDING_REVIEW"],
    ["confirmed then accepted", [rev(1, true)], [rv(2, "ACCEPTED")], "ACCEPTED"],
    ["accepted then machine draft", [rev(1, true), rev(3, false)], [rv(2, "ACCEPTED")], "PENDING_REVIEW"],
    ["rejected then machine draft", [rev(2, false)], [rv(1, "REJECTED")], "PENDING_REVIEW"],
    ["accepted then human correction", [rev(1, true), rev(3, true)], [rv(2, "ACCEPTED")], "PENDING_REVIEW"],
    ["flag then reject (latest wins)", [], [rv(1, "FLAGGED"), rv(2, "REJECTED")], "REJECTED"],
    ["same instant: revision before review", [rev(5, true)], [rv(5, "ACCEPTED")], "ACCEPTED"],
  ] as const)("%s -> %s", (_n, revisions, reviews, expected) => {
    expect(deriveEvidenceStatus([...revisions], [...reviews])).toBe(expected);
  });

  it("extract after ACCEPTED returns status to PENDING_REVIEW (audited); first draft leaves RECEIVED", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    expect(await statusOf(id)).toBe("RECEIVED");
    await confirm(alice, id, confirmBody(1));
    await reviewEvidence(revB, id, review("ACCEPTED"), deps());
    expect(await statusOf(id)).toBe("ACCEPTED");
    expect((await extract(revB, id)).status).toBe(403); // reviewers cannot add drafts
    expect(await statusOf(id)).toBe("ACCEPTED");
    expect((await extract(alice, id)).status).toBe(201);
    expect(await statusOf(id)).toBe("PENDING_REVIEW");
    const audit = (await storage.repo.listAudit(id)).filter((a) => a.eventType === "EXTRACTION_CREATED");
    expect(audit[0].metadata).toMatchObject({ previousStatus: "RECEIVED", newStatus: "RECEIVED", statusResetAfterReview: false });
    expect(audit.at(-1)?.metadata).toMatchObject({ previousStatus: "ACCEPTED", newStatus: "PENDING_REVIEW", statusResetAfterReview: true });
    expect((await trace(revB, id)).evidence.status).toBe("PENDING_REVIEW");
  });

  it("if the status write is lost after the review event, reads show the derived status and the next write repairs it", async () => {
    const id = await upload(alice);
    await extract(alice, id);
    await confirm(alice, id, confirmBody(1)); // stored PENDING_REVIEW
    // Simulate: review event written, status update crashed.
    await storage.repo.insertReview({
      id: crypto.randomUUID(),
      evidenceId: id,
      reviewerId: revB.contributorId,
      decision: "ACCEPTED",
      independenceStatus: "UNVERIFIED",
      reason: "status write lost",
      createdAt: new Date((clock += 1000)).toISOString(),
    });
    expect(await statusOf(id)).toBe("PENDING_REVIEW"); // stale cache
    expect((await trace(alice, id)).evidence.status).toBe("ACCEPTED");
    const q = (await getReviewQueue(revA, deps())).body as ReviewQueueResponse;
    expect(q.items.map((i) => i.id)).not.toContain(id);
    await reviewEvidence(revA, id, review("FLAGGED"), deps());
    expect(await statusOf(id)).toBe("PENDING_REVIEW");
    const audit = (await storage.repo.listAudit(id)).filter((a) => a.eventType === "REVIEW_RECORDED");
    expect(audit.at(-1)?.metadata).toMatchObject({ previousStatus: "ACCEPTED", newStatus: "PENDING_REVIEW" });
  });
});
