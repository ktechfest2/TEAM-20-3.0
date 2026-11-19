/**
 * fixtures/demo_cases.json "corroborated-and-reference-discrepancy" reproduced end to end
 * through the real route handlers (LOCAL_DEV). SYNTHETIC DEMO DATA, not official results.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256HexNode } from "@/lib/evidence/service";
import { resetStorageForTests } from "@/lib/storage";
import { POST as createSession } from "@/app/api/session/route";
import { POST as demoReviewerLogin } from "@/app/api/session/demo-reviewer/route";
import { POST as postEvidence } from "@/app/api/evidence/route";
import { GET as getEvidence } from "@/app/api/evidence/[id]/route";
import { POST as extractRoute } from "@/app/api/evidence/[id]/extract/route";
import { POST as confirmRoute } from "@/app/api/evidence/[id]/confirm/route";
import { POST as reviewRoute } from "@/app/api/evidence/[id]/review/route";
import { POST as importRefRoute } from "@/app/api/references/route";
import { POST as reviewRefRoute } from "@/app/api/references/[id]/review/route";
import { GET as unitRefsRoute } from "@/app/api/units/[id]/references/route";
import { GET as verificationRoute } from "./route";

const BASE = "http://localhost:3000";
// Values from fixtures/demo_cases.json (cross-checked below when the local fixture exists).
const WITNESS = { PARTY_A: 145, PARTY_B: 210, PARTY_C: 42 };
const REFERENCE = { PARTY_A: 145, PARTY_B: 270, PARTY_C: 42 };

let dir: string;
const savedEnv = { ...process.env };
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-verif-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "verif-route-secret-verif-route-secret-01";
  process.env.POLLTRACE_DEMO_REVIEWERS = "1";
  delete process.env.POLLTRACE_DEMO_REVIEWER_PASSCODE;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.VISION_PROVIDER;
  resetStorageForTests();
});
afterAll(async () => {
  process.env = savedEnv;
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});

const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const json = (url: string, cookie: string | null, method = "GET", body?: unknown) =>
  new Request(`${BASE}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const phone = async () => cookieOf(await createSession(new Request(`${BASE}/api/session`, { method: "POST" })));
const reviewer = async (which: "A" | "B") =>
  cookieOf(await demoReviewerLogin(json("/api/session/demo-reviewer", null, "POST", { reviewer: which })));

function png(tag: string): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tag)]);
}

/** Upload a distinct original, read draft, confirm WITNESS figures. Returns evidence id. */
async function witness(cookie: string, unit: string, tag: string): Promise<string> {
  const bytes = png(tag);
  const fd = new FormData();
  fd.set("file", new File([bytes as BlobPart], "p.png"));
  for (const [k, v] of Object.entries({
    electionId: "demo-election",
    pollingUnitId: unit,
    clientSubmissionId: crypto.randomUUID(),
    originalSha256: sha256HexNode(bytes),
  }))
    fd.set(k, v);
  const up = await postEvidence(new Request(`${BASE}/api/evidence`, { method: "POST", body: fd, headers: { cookie } }));
  expect(up.status).toBe(201);
  const { id } = await up.json();
  expect((await extractRoute(json("/x", cookie, "POST", { mode: "MANUAL" }), ctx(id))).status).toBe(201);
  const conf = await confirmRoute(
    json("/x", cookie, "POST", {
      basedOnRevision: 1,
      formType: "EC8A",
      pollingUnitCodeOnSheet: null,
      entries: Object.entries(WITNESS).map(([partyCode, votes]) => ({ partyCode, votes, needsReview: false })),
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: 397,
    }),
    ctx(id),
  );
  expect(conf.status).toBe(201);
  return id;
}

async function accept(cookie: string, id: string, independenceStatus = "REVIEWER_CONFIRMED") {
  const r = await reviewRoute(json("/x", cookie, "POST", { decision: "ACCEPTED", independenceStatus, reason: "Figures legible and match the photo" }), ctx(id));
  expect(r.status).toBe(201);
}

async function importReference(cookie: string, unit: string) {
  const r = await importRefRoute(
    json("/api/references", cookie, "POST", {
      electionId: "demo-election",
      pollingUnitId: unit,
      sourceType: "SYNTHETIC_DEMO",
      sourceDescription: "Synthetic reference result for the demo (fictional)",
      figures: REFERENCE,
      synthetic: true,
    }),
  );
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; version: number; reviewState: string };
}

const verification = async (unit: string, cookie: string | null = null) => {
  const r = await verificationRoute(json(`/api/units/${unit}/verification?electionId=demo-election`, cookie), ctx(unit));
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toMatch(/no-store/);
  return r.json();
};

describe("fixture: corroborated-and-reference-discrepancy (+60)", () => {
  it("matches the local fixture values when present", () => {
    const f = path.join(process.cwd(), "fixtures", "demo_cases.json");
    if (!existsSync(f)) return;
    const fx = JSON.parse(readFileSync(f, "utf8"));
    expect(fx.witnessResult).toEqual(WITNESS);
    expect(fx.referenceResult).toEqual(REFERENCE);
    expect(fx.expectedReferenceMinusWitness).toEqual({ PARTY_B: 60 });
    expect(fx.scenarios.find((s: { id: string }) => s.id === "corroborated-and-reference-discrepancy").expectedStatus).toBe("REFERENCE_DISCREPANCY");
  });

  it("source-confirmed reference + 2 independent witnesses -> REFERENCE_DISCREPANCY, PARTY_B +60", async () => {
    const unit = "demo-pu-012";
    const [w1, w2, revA, revB] = [await phone(), await phone(), await reviewer("A"), await reviewer("B")];
    const e1 = await witness(w1, unit, "different-original-A");
    const e2 = await witness(w2, unit, "different-original-B");
    await accept(revA, e1);
    await accept(revA, e2);

    const before = await verification(unit);
    expect(before.status).toBe("CORROBORATED");

    const ref = await importReference(revB, unit);
    expect(ref.reviewState).toBe("NOT_REVIEWED");
    const self = await reviewRefRoute(json("/x", revB, "POST", { decision: "SOURCE_CONFIRMED", reason: "my own" }), ctx(ref.id));
    expect(self.status).toBe(403);
    expect((await self.json()).error.code).toBe("SELF_REVIEW");
    const confirmed = await reviewRefRoute(json("/x", revA, "POST", { decision: "SOURCE_CONFIRMED", reason: "Synthetic source provenance checked" }), ctx(ref.id));
    expect(confirmed.status).toBe(201);
    expect(await confirmed.json()).toMatchObject({ reviewState: "CONFIRMED", sourceVerified: true });

    const v = await verification(unit); // public: no cookie
    expect(v.status).toBe("REFERENCE_DISCREPANCY");
    expect(v.independentSources).toBe(2);
    expect(v.distinctOriginals).toBe(2);
    expect(v.witnessFigures).toEqual(WITNESS);
    expect(v.differenceUnconfirmed).toBe(false);
    expect(v.synthetic).toBe(true);
    expect(v.reference).toMatchObject({ sourceVerified: true, reviewState: "CONFIRMED", sourceType: "SYNTHETIC_DEMO", synthetic: true });
    const diff = Object.fromEntries(v.differences.map((d: { partyCode: string; referenceMinusWitness: number | null }) => [d.partyCode, d.referenceMinusWitness]));
    expect(diff).toEqual({ PARTY_A: 0, PARTY_B: 60, PARTY_C: 0 });
    for (const r of v.reasons as string[]) expect(r).not.toMatch(/fraud|rigg|fake|authentic/i);

    // Reviewer list shows the version with its reviews.
    const list = await (await unitRefsRoute(json(`/api/units/${unit}/references?electionId=demo-election`, revA), ctx(unit))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 1, reviewState: "CONFIRMED", importedByViewer: false });
    expect((await unitRefsRoute(json(`/api/units/${unit}/references?electionId=demo-election`, w1), ctx(unit))).status).toBe(403);
    expect((await unitRefsRoute(json(`/api/units/${unit}/references?electionId=demo-election`, null), ctx(unit))).status).toBe(401);

    // Public redaction: no contributor ids, aliases, refs used elsewhere, or storage paths.
    const raw = JSON.stringify(v);
    const db = JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8"));
    for (const c of Object.values(db.contributors) as Array<{ id: string; alias: string }>) {
      expect(raw).not.toContain(c.id);
      expect(raw).not.toContain(c.alias);
    }
    expect(raw).not.toMatch(/originals\/|originalPath|contributorRef|reviewerRef|clientSubmissionId|"reason"/);
    const reviewerView = await (await getEvidence(json("/x", revA), ctx(e1))).json();
    expect(raw).not.toContain(reviewerView.contributorRef);
  });

  it("same flow with the reference NOT source-confirmed -> not REFERENCE_DISCREPANCY, differenceUnconfirmed", async () => {
    const unit = "demo-pu-001";
    const [w1, w2, revA, revB] = [await phone(), await phone(), await reviewer("A"), await reviewer("B")];
    const e1 = await witness(w1, unit, "unconfirmed-A");
    const e2 = await witness(w2, unit, "unconfirmed-B");
    await accept(revA, e1);
    await accept(revA, e2);
    await importReference(revB, unit);

    const v = await verification(unit);
    expect(v.status).not.toBe("REFERENCE_DISCREPANCY");
    expect(v.differenceUnconfirmed).toBe(true);
    expect(v.reference).toMatchObject({ sourceVerified: false, reviewState: "NOT_REVIEWED" });
  });

  it("confirmed then rejected source -> REJECTED, sourceVerified false, discrepancy no longer confirmed", async () => {
    const unit = "demo-pu-002";
    const [w1, w2, revA, revB] = [await phone(), await phone(), await reviewer("A"), await reviewer("B")];
    await accept(revA, await witness(w1, unit, "rej-A"));
    await accept(revA, await witness(w2, unit, "rej-B"));
    const ref = await importReference(revB, unit);
    await reviewRefRoute(json("/x", revA, "POST", { decision: "SOURCE_CONFIRMED", reason: "looked fine" }), ctx(ref.id));
    expect((await verification(unit)).status).toBe("REFERENCE_DISCREPANCY");
    const rj = await reviewRefRoute(json("/x", revA, "POST", { decision: "SOURCE_REJECTED", reason: "source could not be traced" }), ctx(ref.id));
    expect(await rj.json()).toMatchObject({ reviewState: "REJECTED", sourceVerified: false });
    const v = await verification(unit);
    expect(v.status).not.toBe("REFERENCE_DISCREPANCY");
    expect(v.reference).toMatchObject({ reviewState: "REJECTED", sourceVerified: false });
    expect(v.differenceUnconfirmed).toBe(true);
  });

  it("public verification: 400 without electionId, 404 unknown unit, works with no evidence", async () => {
    expect((await verificationRoute(json("/api/units/demo-pu-012/verification", null), ctx("demo-pu-012"))).status).toBe(400);
    expect((await verificationRoute(json("/x?electionId=demo-election", null), ctx("demo-pu-999"))).status).toBe(404);
    const empty = await verification("demo-pu-201");
    expect(empty.status).toBe("NO_EVIDENCE");
  });
});
