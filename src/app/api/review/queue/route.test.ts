/**
 * Reviewer workflow over HTTP (LOCAL_DEV, real Request objects and cookies):
 * phone session uploads -> demo reviewer signs in -> queue -> extract/confirm (owner) -> review -> trace.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256HexNode } from "@/lib/evidence/service";
import { resetStorageForTests } from "@/lib/storage";
import { GET as getSession, POST as createSession } from "@/app/api/session/route";
import { POST as demoReviewerLogin } from "@/app/api/session/demo-reviewer/route";
import { POST as postEvidence } from "@/app/api/evidence/route";
import { POST as initUpload } from "@/app/api/evidence/uploads/route";
import { POST as finalizeUpload } from "@/app/api/evidence/uploads/finalize/route";
import { GET as getOriginal } from "@/app/api/evidence/[id]/original/route";
import { POST as reviewRoute } from "@/app/api/evidence/[id]/review/route";
import { POST as extractRoute } from "@/app/api/evidence/[id]/extract/route";
import { POST as confirmRoute } from "@/app/api/evidence/[id]/confirm/route";
import { GET as traceRoute } from "@/app/api/evidence/[id]/trace/route";
import { GET as queueRoute } from "./route";

const BASE = "http://localhost:3000";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 4, 2]);

let dir: string;
const savedEnv = { ...process.env };
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-wfroute-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "wfroute-secret-wfroute-secret-wfroute-01";
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
const req = (url: string, cookie: string | null, method = "GET", body?: unknown) =>
  new Request(`${BASE}${url}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function phone(): Promise<string> {
  return cookieOf(await createSession(new Request(`${BASE}/api/session`, { method: "POST" })));
}
async function reviewer(which: "A" | "B"): Promise<string> {
  const r = await demoReviewerLogin(req("/api/session/demo-reviewer", null, "POST", { reviewer: which }));
  expect(r.status).toBe(200);
  return cookieOf(r);
}
async function uploadAs(cookie: string, bytes = PNG) {
  const fd = new FormData();
  fd.set("file", new File([bytes as BlobPart], "p.png"));
  fd.set("electionId", "demo-election");
  fd.set("pollingUnitId", "demo-pu-012");
  fd.set("clientSubmissionId", crypto.randomUUID());
  fd.set("originalSha256", sha256HexNode(bytes));
  fd.set("capturedAtClaimed", "2026-11-19T13:00:00.000Z");
  return postEvidence(new Request(`${BASE}/api/evidence`, { method: "POST", body: fd, headers: { cookie } }));
}

describe("reviewer workflow over HTTP", () => {
  it("end to end with ACL and error codes the UI relies on", async () => {
    const owner = await phone();
    const stranger = await phone();
    const revA = await reviewer("A");

    // GET /api/session exposes role (no ids).
    const s = await (await getSession(req("/api/session", revA))).json();
    expect(s).toMatchObject({ authenticated: true, role: "REVIEWER", synthetic: true });
    expect(JSON.stringify(s)).not.toMatch(/de000000/);
    expect((await (await getSession(req("/api/session", owner))).json()).role).toBe("CONTRIBUTOR");

    const up = await uploadAs(owner);
    expect(up.status).toBe(201);
    const { id } = await up.json();

    // Reviewer sessions cannot submit evidence on any path.
    for (const res of [
      await uploadAs(revA),
      await initUpload(req("/api/evidence/uploads", revA, "POST", {})),
      await finalizeUpload(req("/api/evidence/uploads/finalize", revA, "POST", {})),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("REVIEWER_SESSION");
    }

    // Queue: reviewer only.
    expect((await queueRoute(req("/api/review/queue", null))).status).toBe(401);
    expect((await queueRoute(req("/api/review/queue", owner))).status).toBe(403);
    const q = await (await queueRoute(req("/api/review/queue", revA))).json();
    expect(q.items.map((i: { id: string }) => i.id)).toContain(id);

    // Demo reviewer is a different contributor than the phone session: no SELF_REVIEW.
    const accept0 = await reviewRoute(req(`/api/evidence/${id}/review`, revA, "POST", { decision: "ACCEPTED", independenceStatus: "UNVERIFIED", reason: "Looks complete" }), ctx(id));
    expect(accept0.status).toBe(409);
    expect((await accept0.json()).error.code).toBe("NO_CONFIRMED_REVISION");

    // Extract with no body (defaults AUTO) works; explicit REAL_VISION -> 422 MODE_UNAVAILABLE.
    const ex = await extractRoute(new Request(`${BASE}/x`, { method: "POST", headers: { cookie: owner } }), ctx(id));
    expect(ex.status).toBe(201);
    expect((await ex.json()).modeUsed).toBe("DEMO_FIXTURE");
    const rv = await extractRoute(req(`/x`, revA, "POST", { mode: "REAL_VISION" }), ctx(id));
    expect(rv.status).toBe(422);
    expect((await rv.json()).error.code).toBe("MODE_UNAVAILABLE");

    const body = {
      basedOnRevision: 1,
      formType: "EC8A",
      pollingUnitCodeOnSheet: "DEMO.00.00.012",
      entries: [
        { partyCode: "PARTY_A", votes: 145, needsReview: false },
        { partyCode: "PARTY_B", votes: 210, needsReview: false },
        { partyCode: "PARTY_C", votes: 42, needsReview: false },
      ],
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: 397,
    };
    expect((await confirmRoute(req("/x", revA, "POST", body), ctx(id))).status).toBe(403);
    expect((await confirmRoute(req("/x", stranger, "POST", body), ctx(id))).status).toBe(404);
    expect((await confirmRoute(req("/x", owner, "POST", body), ctx(id))).status).toBe(201);
    const stale = await confirmRoute(req("/x", owner, "POST", body), ctx(id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE_REVISION");

    // Contributor cannot review; reviewer can.
    expect((await reviewRoute(req("/x", owner, "POST", { decision: "FLAGGED", independenceStatus: "UNVERIFIED", reason: "x".repeat(5) }), ctx(id))).status).toBe(403);
    const ok = await reviewRoute(req("/x", revA, "POST", { decision: "ACCEPTED", independenceStatus: "UNVERIFIED", reason: "Figures match the photo" }), ctx(id));
    expect(ok.status).toBe(201);
    expect((await ok.json()).status).toBe("ACCEPTED");

    // Reviewer can open the private original of evidence they review.
    const orig = await getOriginal(req("/x", revA), ctx(id));
    expect(orig.status).toBe(200);
    expect(sha256HexNode(new Uint8Array(await orig.arrayBuffer()))).toBe(sha256HexNode(PNG));

    // Trace.
    expect((await traceRoute(req("/x", stranger), ctx(id))).status).toBe(404);
    const t = await (await traceRoute(req("/x", revA), ctx(id))).json();
    expect(t.timeline.map((e: { type: string }) => e.type)).toEqual(["CAPTURE_CLAIMED", "RECEIVED", "EXTRACTION", "HUMAN_CONFIRMATION", "REVIEW"]);
    expect(t.permissions).toMatchObject({ canReview: true, canConfirm: false, availableExtractionModes: ["DEMO_FIXTURE", "MANUAL"] });
    expect(t.evidence.status).toBe("ACCEPTED");
  });

  it("review body validation and malformed JSON", async () => {
    const owner = await phone();
    const { id } = await (await uploadAs(owner)).json();
    const revB = await reviewer("B");
    expect((await reviewRoute(req("/x", revB, "POST", { decision: "MAYBE" }), ctx(id))).status).toBe(400);
    const bad = new Request(`${BASE}/x`, { method: "POST", headers: { cookie: revB, "content-type": "application/json" }, body: "{" });
    expect((await reviewRoute(bad, ctx(id))).status).toBe(400);
  });
});
