import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceView } from "@/lib/contracts/verification";
import type { Principal } from "@/lib/auth/session";
import { createFixedWindowLimiter } from "@/lib/evidence/rate-limit";
import type { WorkflowDeps } from "@/lib/evidence/workflow";
import { createLocalStorage } from "@/lib/storage/local";
import type { EvidenceRecord, EvidenceStorage, ReviewEventRecord, RevisionRecord } from "@/lib/storage";
import { importReference, listUnitReferences, reviewReference, toEvidenceInput } from "./service";

const contributor: Principal = { contributorId: "11111111-1111-4111-8111-111111111111", role: "CONTRIBUTOR", alias: "Anon", synthetic: false };
const revA: Principal = { contributorId: "de000000-0000-4000-8000-00000000a001", role: "REVIEWER", alias: "Synthetic Demo Reviewer A", synthetic: true };
const revB: Principal = { contributorId: "de000000-0000-4000-8000-00000000b002", role: "REVIEWER", alias: "Synthetic Demo Reviewer B", synthetic: true };

let dir: string;
let storage: EvidenceStorage;
let clock: number;
const deps = (): WorkflowDeps => ({
  storage,
  rateLimiter: createFixedWindowLimiter(10_000, 60_000),
  now: () => new Date((clock += 1000)),
});

const refBody = (over: Record<string, unknown> = {}) => ({
  electionId: "demo-election",
  pollingUnitId: "demo-pu-012",
  sourceType: "SYNTHETIC_DEMO",
  sourceDescription: "Synthetic reference sheet for the demo",
  figures: { PARTY_A: 145, PARTY_B: 270, PARTY_C: 42 },
  synthetic: true,
  ...over,
});
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;
const importOk = async (p: Principal = revB, over: Record<string, unknown> = {}) => {
  const r = await importReference(p, refBody(over), deps());
  expect(r.status).toBe(201);
  return r.body as ReferenceView;
};
const reviewBody = (decision: "SOURCE_CONFIRMED" | "SOURCE_REJECTED") => ({ decision, reason: `Source checked: ${decision}` });

const savedSecret = process.env.POLLTRACE_SESSION_SECRET;
beforeAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = "references-test-secret-references-test-01";
});
afterAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = savedSecret;
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-ref-"));
  storage = createLocalStorage(dir);
  clock = Date.parse("2026-11-19T16:00:00.000Z");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("ACL matrix (reviewer endpoints)", () => {
  type Actor = "none" | "contributor" | "reviewer" | "importer";
  const P: Record<Actor, Principal | null> = { none: null, contributor, reviewer: revA, importer: revB };
  const cases: Array<["import" | "review" | "list", Actor, number, string?]> = [
    ["import", "none", 401, "UNAUTHENTICATED"],
    ["import", "contributor", 403, "REVIEWER_ONLY"],
    ["import", "reviewer", 201],
    ["review", "none", 401, "UNAUTHENTICATED"],
    ["review", "contributor", 403, "REVIEWER_ONLY"],
    ["review", "reviewer", 201],
    ["review", "importer", 403, "SELF_REVIEW"],
    ["list", "none", 401, "UNAUTHENTICATED"],
    ["list", "contributor", 403, "REVIEWER_ONLY"],
    ["list", "reviewer", 200],
  ];
  it.each(cases)("%s as %s -> %i %s", async (op, actor, status, c) => {
    const ref = await importOk(revB);
    const p = P[actor];
    const r =
      op === "import"
        ? await importReference(p, refBody(), deps())
        : op === "review"
          ? await reviewReference(p, ref.id, reviewBody("SOURCE_CONFIRMED"), deps())
          : await listUnitReferences(p, "demo-pu-012", "demo-election", deps());
    expect(r.status).toBe(status);
    if (c) expect(code(r)).toBe(c);
  });

  it("review of unknown / malformed reference id -> 404", async () => {
    expect((await reviewReference(revA, crypto.randomUUID(), reviewBody("SOURCE_CONFIRMED"), deps())).status).toBe(404);
    expect((await reviewReference(revA, "../x", reviewBody("SOURCE_CONFIRMED"), deps())).status).toBe(404);
  });
});

describe("import validation", () => {
  it.each([
    ["unknown party", { figures: { PARTY_A: 1, PARTY_Z: 2 } }, 400, "INVALID_FIGURES"],
    ["no figures", { figures: {} }, 400, "INVALID_FIGURES"],
    ["negative votes", { figures: { PARTY_A: -1 } }, 400, "INVALID_REQUEST"],
    ["fractional votes", { figures: { PARTY_A: 1.5 } }, 400, "INVALID_REQUEST"],
    ["unknown election", { electionId: "nope" }, 400, "UNKNOWN_ELECTION"],
    ["unknown polling unit", { pollingUnitId: "demo-pu-999" }, 400, "UNKNOWN_POLLING_UNIT"],
    ["short description", { sourceDescription: "x" }, 400, "INVALID_REQUEST"],
    ["unknown source type", { sourceType: "TWITTER" }, 400, "INVALID_REQUEST"],
    ["not a URL", { sourceUrl: "not a url" }, 400, "INVALID_REQUEST"],
    ["javascript: URL", { sourceUrl: "javascript:alert(1)" }, 400, undefined],
    ["file: URL", { sourceUrl: "file:///etc/passwd" }, 400, undefined],
    ["ftp: URL", { sourceUrl: "ftp://example.org/x" }, 400, undefined],
    ["URL with credentials", { sourceUrl: "https://user:pw@example.org/x" }, 400, "INVALID_SOURCE_URL"],
    ["URL too long", { sourceUrl: `https://example.org/${"a".repeat(3000)}` }, 400, "INVALID_SOURCE_URL"],
    ["synthetic unit marked non-synthetic", { synthetic: false, sourceType: "MANUAL_IREV" }, 400, "SYNTHETIC_REQUIRED"],
    ["SYNTHETIC_DEMO marked non-synthetic", { synthetic: false }, 400, "SYNTHETIC_REQUIRED"],
  ] as const)("%s -> %i %s", async (_n, over, status, c) => {
    const r = await importReference(revB, refBody(over), deps());
    expect(r.status).toBe(status);
    if (c) expect(code(r)).toBe(c);
    expect(await storage.repo.listReferences("demo-election", "demo-pu-012")).toHaveLength(0);
  });

  it("sourceUrl is stored as text and NEVER requested (no SSRF)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ref = await importOk(revB, { sourceType: "MANUAL_IREV", sourceUrl: "http://169.254.169.254/latest/meta-data/" });
    expect(ref.sourceUrl).toBe("http://169.254.169.254/latest/meta-data/");
    await reviewReference(revA, ref.id, reviewBody("SOURCE_CONFIRMED"), deps());
    await listUnitReferences(revA, "demo-pu-012", "demo-election", deps());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("partial figures (subset of roster) are allowed", async () => {
    const ref = await importOk(revB, { figures: { PARTY_B: 270 } });
    expect(ref.figures).toEqual({ PARTY_B: 270 });
  });
});

describe("versions and derived sourceVerified", () => {
  it("each import is a new immutable version; audited", async () => {
    const v1 = await importOk(revB);
    const v2 = await importOk(revA, { figures: { PARTY_A: 1, PARTY_B: 2, PARTY_C: 3 } });
    const v3 = await importOk(revB);
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    const all = await storage.repo.listReferences("demo-election", "demo-pu-012");
    expect(all[0].figures).toEqual({ PARTY_A: 145, PARTY_B: 270, PARTY_C: 42 }); // v1 untouched
    const otherUnit = await importOk(revB, { pollingUnitId: "demo-pu-001" });
    expect(otherUnit.version).toBe(1);
  });

  it("concurrent imports get distinct consecutive versions", async () => {
    const rs = await Promise.all([1, 2, 3].map(() => importReference(revB, refBody(), deps())));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect((await storage.repo.listReferences("demo-election", "demo-pu-012")).map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it("confirmed -> true; later rejected -> false; reviews append-only; a new version starts unverified", async () => {
    const ref = await importOk(revB);
    expect(ref.sourceVerified).toBe(false);
    expect(ref.reviewState).toBe("NOT_REVIEWED");
    const c = (await reviewReference(revA, ref.id, reviewBody("SOURCE_CONFIRMED"), deps())).body as ReferenceView;
    expect(c.sourceVerified).toBe(true);
    expect(c.reviewState).toBe("CONFIRMED");
    expect(c.reviews).toHaveLength(1);
    expect(c.reviews[0]).toMatchObject({ decision: "SOURCE_CONFIRMED", byViewer: true });
    expect(c.reviews[0].reviewerRef).toMatch(/^[0-9a-f]{12}$/);
    const rj = (await reviewReference(revA, ref.id, reviewBody("SOURCE_REJECTED"), deps())).body as ReferenceView;
    expect(rj.sourceVerified).toBe(false);
    expect(rj.reviewState).toBe("REJECTED");
    expect(rj.reviews.map((x) => x.decision)).toEqual(["SOURCE_CONFIRMED", "SOURCE_REJECTED"]);

    const v2 = await importOk(revB);
    const list = (await listUnitReferences(revA, "demo-pu-012", "demo-election", deps())).body as ReferenceView[];
    expect(list.map((r) => [r.version, r.reviewState, r.sourceVerified, r.importedByViewer])).toEqual([
      [1, "REJECTED", false, false],
      [v2.version, "NOT_REVIEWED", false, false],
    ]);
    const db = JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8"));
    const refAudit = db.audit.filter((a: { evidenceId: string | null }) => a.evidenceId === null);
    expect(refAudit.map((a: { eventType: string }) => a.eventType)).toEqual([
      "REFERENCE_IMPORTED",
      "REFERENCE_REVIEWED",
      "REFERENCE_REVIEWED",
      "REFERENCE_IMPORTED",
    ]);
    expect(refAudit[2].metadata).toMatchObject({ decision: "SOURCE_REJECTED", reviewStateAfter: "REJECTED", sourceVerifiedAfter: false });
  });

  it("list: 400 without electionId, 404 unknown unit", async () => {
    expect((await listUnitReferences(revA, "demo-pu-012", null, deps())).status).toBe(400);
    expect((await listUnitReferences(revA, "demo-pu-999", "demo-election", deps())).status).toBe(404);
  });
});

describe("engine input assembly", () => {
  const e = { id: "e1", sha256: "a".repeat(64), contributorId: "c1", receivedAt: "2026-11-19T10:00:00.000Z", synthetic: true } as EvidenceRecord;
  const rev = (n: number, at: string, humanConfirmed: boolean) =>
    ({ revisionNumber: n, createdAt: at, humanConfirmed, formType: "EC8A", entries: [{ partyCode: "PARTY_A", votes: 1, needsReview: false }] }) as RevisionRecord;
  const rv = (at: string, decision: ReviewEventRecord["decision"]) =>
    ({ createdAt: at, decision, independenceStatus: "REVIEWER_CONFIRMED" }) as ReviewEventRecord;
  it.each([
    ["accepted after confirm", [rev(1, "T1", true)], [rv("T2", "ACCEPTED")], "ACCEPTED", true],
    ["accepted, then a newer human correction", [rev(1, "T1", true), rev(2, "T3", true)], [rv("T2", "ACCEPTED")], null, true],
    ["accepted, then a newer machine draft", [rev(1, "T1", true), rev(2, "T3", false)], [rv("T2", "ACCEPTED")], null, false],
    ["never reviewed", [rev(1, "T1", true)], [], null, true],
  ] as const)("%s -> decision %s, confirmed %s", (_n, revs, reviews, decision, confirmed) => {
    const input = toEvidenceInput(e, [...revs], [...reviews], () => "ref");
    expect(input.latestDecision).toBe(decision);
    expect(input.confirmed !== null).toBe(confirmed);
  });
});
