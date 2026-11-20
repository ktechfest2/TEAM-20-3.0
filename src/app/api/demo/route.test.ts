/**
 * Guided /demo server side, through the real route handlers (LOCAL_DEV, fresh store per test).
 * SYNTHETIC DEMO DATA ONLY.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_REVIEWER_A, DEMO_SUBMISSION_IDS, DEMO_WITNESSES } from "@/lib/demo/actors";
import { sha256HexNode } from "@/lib/evidence/service";
import { createLocalStorage } from "@/lib/storage/local";
import { getStorage, resetStorageForTests } from "@/lib/storage";
import { POST as createSession } from "@/app/api/session/route";
import { POST as demoReviewerLogin } from "@/app/api/session/demo-reviewer/route";
import { POST as postEvidence } from "@/app/api/evidence/route";
import { POST as reviewRoute } from "@/app/api/evidence/[id]/review/route";
import { GET as verificationRoute } from "@/app/api/units/[id]/verification/route";
import { GET as getDemo } from "./route";
import { POST as stageRoute } from "./stages/[stage]/route";
import { POST as resetRoute } from "./reset/route";

const BASE = "http://localhost:3000";
const PASS = "presenter-passcode-7f3a9c";
const STAGES = ["WITNESSES", "DUPLICATE", "REVIEWS", "REFERENCE"] as const;

let dir: string;
const savedEnv = { ...process.env };
let ipCounter = 0;
let ip: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-demo-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "demo-route-secret-demo-route-secret-0001";
  process.env.POLLTRACE_DEMO_REVIEWERS = "1";
  process.env.POLLTRACE_DEMO_ADMIN_PASSCODE = PASS;
  delete process.env.POLLTRACE_DEMO_REVIEWER_PASSCODE;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.VISION_PROVIDER;
  (globalThis as { __polltraceDemoFailures?: unknown }).__polltraceDemoFailures = undefined;
  ip = `203.0.113.${++ipCounter}`;
  resetStorageForTests();
});
afterEach(async () => {
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});
afterAll(() => {
  process.env = savedEnv;
});

const admin = (url: string, body: unknown, fromIp = ip) =>
  new Request(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${fromIp}, 10.0.0.1` },
    body: JSON.stringify(body),
  });
const stage = (s: string, passcode = PASS, fromIp = ip) =>
  stageRoute(admin(`/api/demo/stages/${s}`, { passcode }, fromIp), { params: Promise.resolve({ stage: s }) });
const reset = (passcode = PASS) => resetRoute(admin("/api/demo/reset", { passcode }));
const state = async () => (await getDemo()).json();
const code = async (r: Response) => (await r.json()).error?.code;

async function runAll() {
  for (const s of STAGES) {
    const r = await stage(s);
    expect(r.status, s).toBe(200);
  }
}
const db = async () => JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8"));
const counts = async () => {
  const d = await db();
  return {
    evidence: Object.keys(d.evidence).length,
    revisions: d.revisions.length,
    reviews: d.reviews.length,
    references: d.references.length,
    referenceReviews: d.referenceReviews.length,
    audit: d.audit.length,
  };
};

describe("access, passcode, disabled, rate limit", () => {
  it("GET /api/demo is public and reports enabled without secrets", async () => {
    const s = await state();
    expect(s).toMatchObject({ enabled: true, unitId: "demo-pu-012", electionId: "demo-election", synthetic: true, verificationStatus: "NO_EVIDENCE", referenceId: null });
    expect(s.stages.map((x: { id: string; done: boolean }) => [x.id, x.done])).toEqual(STAGES.map((id) => [id, false]));
    expect(JSON.stringify(s)).not.toContain(PASS);
  });

  it.each([
    ["no admin passcode configured", { POLLTRACE_DEMO_ADMIN_PASSCODE: "" }],
    ["demo reviewers flag off", { POLLTRACE_DEMO_REVIEWERS: "0" }],
  ])("%s -> enabled false, stage/reset 403 DEMO_DISABLED", async (_n, env) => {
    Object.assign(process.env, env);
    expect((await state()).enabled).toBe(false);
    const r = await stage("WITNESSES");
    expect(r.status).toBe(403);
    expect(await code(r)).toBe("DEMO_DISABLED");
    expect(await code(await reset())).toBe("DEMO_DISABLED");
  });

  it("wrong passcode -> 401; bad body -> 400; unknown stage -> 404 (after auth)", async () => {
    const wrong = await stage("WITNESSES", "nope");
    expect(wrong.status).toBe(401);
    expect(await code(wrong)).toBe("DEMO_PASSCODE_INVALID");
    expect((await stageRoute(admin("/api/demo/stages/WITNESSES", { pass: 1 }), { params: Promise.resolve({ stage: "WITNESSES" }) })).status).toBe(400);
    const unknown = await stage("TELEPORT");
    expect(unknown.status).toBe(404);
    expect((await reset("nope")).status).toBe(401);
    expect(await counts().catch(() => null)).toBeNull(); // nothing was written
  });

  it("5 wrong passcodes from one IP -> 429 even with the right one; other IPs unaffected", async () => {
    for (let i = 0; i < 5; i++) expect((await stage("WITNESSES", `bad-${i}`)).status).toBe(401);
    const blocked = await stage("WITNESSES", PASS);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await stage("WITNESSES", PASS, "198.51.100.7")).status).toBe(200);
  });
});

describe("stages", () => {
  it("out of order -> 409 DEMO_STAGE_ORDER naming what is missing", async () => {
    const r = await stage("REFERENCE");
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "DEMO_STAGE_ORDER", missing: ["WITNESSES", "DUPLICATE", "REVIEWS"] } });
    expect((await stage("WITNESSES")).status).toBe(200);
    expect(await code(await stage("REVIEWS"))).toBe("DEMO_STAGE_ORDER");
  });

  it("full run -> REFERENCE_DISCREPANCY, PARTY_B +60, copy excluded, 2 independent sources; real service paths", async () => {
    const responses: string[] = [];
    for (const s of STAGES) {
      const r = await stage(s);
      expect(r.status).toBe(200);
      responses.push(await r.text());
    }
    const s = JSON.parse(responses.at(-1)!);
    expect(s.stages.every((x: { done: boolean }) => x.done)).toBe(true);
    expect(s.verificationStatus).toBe("REFERENCE_DISCREPANCY");
    expect(s.evidence.witness1).toBeTruthy();
    expect(s.referenceId).toBeTruthy();
    for (const body of responses) expect(body).not.toContain(PASS);

    const v = await (
      await verificationRoute(new Request(`${BASE}/api/units/demo-pu-012/verification?electionId=demo-election`), { params: Promise.resolve({ id: "demo-pu-012" }) })
    ).json();
    expect(v.status).toBe("REFERENCE_DISCREPANCY");
    expect(v.independentSources).toBe(2);
    expect(v.distinctOriginals).toBe(2);
    expect(v.differences.find((d: { partyCode: string }) => d.partyCode === "PARTY_B").referenceMinusWitness).toBe(60);
    const dup = v.members.find((m: { evidenceId: string }) => m.evidenceId === s.evidence.duplicate);
    expect(dup).toMatchObject({ eligible: false, duplicateOf: s.evidence.witness1 });

    // Went through the real upload service: server hash recorded, same bytes for W1 and W3.
    const d = await db();
    const w1 = d.evidence[s.evidence.witness1];
    const w3 = d.evidence[s.evidence.duplicate];
    expect(w1.sha256).toBe(w3.sha256);
    expect(w1.mime).toBe("image/jpeg");
    expect(w1.synthetic).toBe(true);
    const received = d.audit.filter((a: { eventType: string }) => a.eventType === "EVIDENCE_RECEIVED");
    expect(received).toHaveLength(3);
    expect(received.every((a: { metadata: { clientSha256Matched: boolean } }) => a.metadata.clientSha256Matched)).toBe(true);
    expect(d.revisions.filter((r: { origin: string }) => r.origin === "DEMO_FIXTURE")).toHaveLength(3);
    expect(d.reviews.map((r: { independenceStatus: string }) => r.independenceStatus).sort()).toEqual(["REVIEWER_CONFIRMED", "REVIEWER_CONFIRMED", "UNVERIFIED"]);
    const original = await createLocalStorage(dir).objects.get(w1.originalPath);
    expect(sha256HexNode(original!)).toBe(w1.sha256);
  });

  it("re-running done stages is idempotent: same state, no new rows or audit", async () => {
    await runAll();
    const before = await counts();
    const s1 = await state();
    for (const s of STAGES) {
      const r = await stage(s);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual(s1);
    }
    expect(await counts()).toEqual(before);
  });
});

describe("reset scope", () => {
  it("removes exactly the demo actors' rows; presenter evidence (+ a demo reviewer's review of it) survives; rerun works", async () => {
    // Presenter's own live capture on the demo unit, reviewed by demo Reviewer A.
    const phone = (await createSession(new Request(`${BASE}/api/session`, { method: "POST" }))).headers.get("set-cookie")!.split(";")[0];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x70, 0x72, 0x65]);
    const fd = new FormData();
    fd.set("file", new File([bytes as BlobPart], "p.jpg"));
    fd.set("electionId", "demo-election");
    fd.set("pollingUnitId", "demo-pu-012");
    fd.set("clientSubmissionId", crypto.randomUUID());
    fd.set("originalSha256", sha256HexNode(bytes));
    const presenter = await (await postEvidence(new Request(`${BASE}/api/evidence`, { method: "POST", body: fd, headers: { cookie: phone } }))).json();
    const revA = (
      await demoReviewerLogin(new Request(`${BASE}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviewer: "A" }) }))
    ).headers.get("set-cookie")!.split(";")[0];
    const flag = await reviewRoute(
      new Request(`${BASE}/x`, { method: "POST", headers: { cookie: revA, "content-type": "application/json" }, body: JSON.stringify({ decision: "FLAGGED", independenceStatus: "UNVERIFIED", reason: "presenter capture, needs a look" }) }),
      { params: Promise.resolve({ id: presenter.id }) },
    );
    expect(flag.status).toBe(201);

    await runAll();
    const full = await db();
    const demoPaths = Object.values(full.evidence as Record<string, { contributorId: string; originalPath: string }>)
      .filter((e) => DEMO_WITNESSES.some((w) => w.id === e.contributorId))
      .map((e) => e.originalPath);
    expect(demoPaths).toHaveLength(3);
    const presenterPath = full.evidence[presenter.id].originalPath;

    const r = await reset();
    expect(r.status).toBe(200);
    const after = await r.json();
    expect(after.stages.every((x: { done: boolean }) => !x.done)).toBe(true);
    expect(after.evidence).toEqual({ witness1: null, witness2: null, duplicate: null });
    expect(after.referenceId).toBeNull();
    expect(JSON.stringify(after)).not.toContain(PASS);

    const d = await db();
    expect(Object.keys(d.evidence)).toEqual([presenter.id]);
    expect(d.reviews).toHaveLength(1);
    expect(d.reviews[0]).toMatchObject({ evidenceId: presenter.id, reviewerId: DEMO_REVIEWER_A.id, decision: "FLAGGED" });
    expect(d.revisions).toHaveLength(0);
    expect(d.references).toHaveLength(0);
    expect(d.referenceReviews).toHaveLength(0);
    expect(d.audit.some((a: { evidenceId: string | null }) => a.evidenceId === presenter.id)).toBe(true);
    expect(d.audit.filter((a: { eventType: string }) => a.eventType.startsWith("REFERENCE_"))).toHaveLength(0);
    expect(d.audit.filter((a: { eventType: string }) => a.eventType === "DEMO_STAGE_RUN")).toHaveLength(4); // history kept
    const resetAudit = d.audit.find((a: { eventType: string }) => a.eventType === "DEMO_SCENARIO_RESET");
    expect(resetAudit.metadata).toMatchObject({ evidence: 3, references: 1, referenceReviews: 1, reviews: 3, originalsRemoved: 3 });
    for (const p of demoPaths) expect(existsSync(path.join(dir, "objects", p))).toBe(false);
    expect(existsSync(path.join(dir, "objects", presenterPath))).toBe(true);
    expect(await getStorage().repo.findEvidenceBySubmission(DEMO_WITNESSES[0].id, DEMO_SUBMISSION_IDS.witness1)).toBeNull();

    // Re-running all stages after reset works.
    await runAll();
    const again = await state();
    expect(again.verificationStatus).toBe("REFERENCE_DISCREPANCY");
    expect(Object.keys((await db()).evidence)).toHaveLength(4);
  });

  it("reset with nothing to delete is a no-op that still records an audit event", async () => {
    const r = await reset();
    expect(r.status).toBe(200);
    const d = await db();
    expect(d.audit.map((a: { eventType: string }) => a.eventType)).toEqual(["DEMO_SCENARIO_RESET"]);
  });

  it("storage guards: non-synthetic unit refused; original removal refuses non-demo keys", async () => {
    const s = createLocalStorage(dir);
    await expect(s.repo.resetDemoScenario("real-unit", [DEMO_WITNESSES[0].id], [])).rejects.toThrow(/not a synthetic unit/);
    await expect(
      s.objects.removeDemoOriginals([`originals/11111111-1111-4111-8111-111111111111/${crypto.randomUUID()}/${"a".repeat(64)}.jpg`], DEMO_WITNESSES.map((w) => w.id)),
    ).rejects.toThrow(/non-demo/);
    await expect(s.objects.removeDemoOriginals(["staging/x"], DEMO_WITNESSES.map((w) => w.id))).rejects.toThrow(/non-demo/);
  });
});
