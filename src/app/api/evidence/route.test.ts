/**
 * Route-level tests with real Request/FormData against the LOCAL_DEV adapter in a temp dir.
 * Exercises the exact flow the sync client uses: POST /api/session -> cookie -> POST /api/evidence.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import { sha256HexNode } from "@/lib/evidence/service";
import { resetStorageForTests } from "@/lib/storage";
import { POST as createSession } from "@/app/api/session/route";
import { POST as demoReviewerLogin } from "@/app/api/session/demo-reviewer/route";
import { POST as postEvidence } from "./route";
import { GET as getEvidence } from "./[id]/route";
import { GET as getOriginal } from "./[id]/original/route";

const BASE = "http://localhost:3000";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 7, 7, 7]);

let dir: string;
const savedEnv = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-route-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.POLLTRACE_DEMO_REVIEWERS = "1";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetStorageForTests();
});
afterAll(async () => {
  process.env = savedEnv;
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

async function newContributorCookie(): Promise<string> {
  const res = await createSession(new Request(`${BASE}/api/session`, { method: "POST" }));
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Lax/);
  return cookieFrom(res);
}

function evidenceRequest(cookie: string | null, bytes: Uint8Array, over: Record<string, string> = {}): Request {
  const fd = new FormData();
  fd.set("file", new File([bytes as BlobPart], "photo.png", { type: "image/png" })); // lying client MIME on purpose
  const fields = {
    electionId: "demo-election",
    pollingUnitId: "demo-pu-012",
    clientSubmissionId: crypto.randomUUID(),
    originalSha256: sha256HexNode(bytes),
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(`${BASE}/api/evidence`, { method: "POST", body: fd, headers: cookie ? { cookie } : {} });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/evidence (route handler)", () => {
  let cookie: string;
  beforeEach(async () => {
    cookie = await newContributorCookie();
  });

  it("401 without session cookie", async () => {
    const res = await postEvidence(evidenceRequest(null, JPEG));
    expect(res.status).toBe(401);
  });

  it("401 with forged cookie", async () => {
    const res = await postEvidence(evidenceRequest("pt_session=v1.eyJzdWIiOiJ4In0.AAAA", JPEG));
    expect(res.status).toBe(401);
  });

  it("201 then identical retry 200 with byte-identical receipt; conflicting reuse 409", async () => {
    const csid = crypto.randomUUID();
    const first = await postEvidence(evidenceRequest(cookie, JPEG, { clientSubmissionId: csid }));
    expect(first.status).toBe(201);
    const receipt = await first.json();
    expect(receipt).toMatchObject({ sha256: sha256HexNode(JPEG), status: "RECEIVED", storageMode: "LOCAL_DEV", synthetic: true });

    const retry = await postEvidence(evidenceRequest(cookie, JPEG, { clientSubmissionId: csid }));
    expect(retry.status).toBe(200);
    expect(retry.headers.get("idempotent-replay")).toBe("true");
    expect(await retry.json()).toEqual(receipt);

    const other = new Uint8Array(JPEG);
    other[12] = 8;
    const conflict = await postEvidence(evidenceRequest(cookie, other, { clientSubmissionId: csid }));
    expect(conflict.status).toBe(409);
  });

  it("413 via Content-Length precheck before parsing", async () => {
    const req = new Request(`${BASE}/api/evidence`, {
      method: "POST",
      headers: { cookie, "content-length": String(MAX_ORIGINAL_BYTES * 2), "content-type": "multipart/form-data; boundary=x" },
      body: "x",
    });
    expect((await postEvidence(req)).status).toBe(413);
  });

  it("400 on non-multipart body", async () => {
    const req = new Request(`${BASE}/api/evidence`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
    expect((await postEvidence(req)).status).toBe(400);
  });

  it("POST /api/session is idempotent for an existing valid session", async () => {
    const res = await createSession(new Request(`${BASE}/api/session`, { method: "POST", headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /api/evidence/:id access + redaction", () => {
  it("owner sees own alias; reviewer sees opaque ref; other contributor 404; no private fields", async () => {
    const owner = await newContributorCookie();
    const created = await (await postEvidence(evidenceRequest(owner, JPEG))).json();

    const ownerView = await (await getEvidence(new Request(`${BASE}/x`, { headers: { cookie: owner } }), params(created.id))).json();
    expect(ownerView).toMatchObject({ viewer: "OWNER", submittedByViewer: true, synthetic: true, capturedAtIsClaimOnly: true });
    expect(ownerView.contributorAlias).toMatch(/^Anonymous contributor/);
    expect(ownerView.auditTrail).toEqual([expect.objectContaining({ eventType: "EVIDENCE_RECEIVED", byViewer: true })]);

    const login = await demoReviewerLogin(
      new Request(`${BASE}/api/session/demo-reviewer`, { method: "POST", body: JSON.stringify({ reviewer: "A" }) }),
    );
    expect(login.status).toBe(200);
    const reviewer = cookieFrom(login);
    const revView = await (await getEvidence(new Request(`${BASE}/x`, { headers: { cookie: reviewer } }), params(created.id))).json();
    expect(revView.viewer).toBe("REVIEWER");
    expect(revView.contributorRef).toMatch(/^[0-9a-f]{12}$/);
    expect(revView.contributorAlias).toBeUndefined();
    expect(revView.clientSubmissionId).toBeUndefined();

    for (const v of [ownerView, revView]) {
      const s = JSON.stringify(v);
      expect(s).not.toMatch(/originalPath|originals\/|contributorId/);
    }

    const stranger = await newContributorCookie();
    expect((await getEvidence(new Request(`${BASE}/x`, { headers: { cookie: stranger } }), params(created.id))).status).toBe(404);
    expect((await getEvidence(new Request(`${BASE}/x`), params(created.id))).status).toBe(401);

    const orig = await getOriginal(new Request(`${BASE}/x`, { headers: { cookie: reviewer } }), params(created.id));
    expect(orig.status).toBe(200);
    expect(orig.headers.get("content-type")).toBe("image/jpeg");
    expect(sha256HexNode(new Uint8Array(await orig.arrayBuffer()))).toBe(created.sha256);
    expect((await getOriginal(new Request(`${BASE}/x`, { headers: { cookie: stranger } }), params(created.id))).status).toBe(404);
  });

  it("demo reviewer login is refused when flag is off, and existing reviewer cookies stop working", async () => {
    const login = await demoReviewerLogin(
      new Request(`${BASE}/api/session/demo-reviewer`, { method: "POST", body: JSON.stringify({ reviewer: "B" }) }),
    );
    const reviewer = cookieFrom(login);
    process.env.POLLTRACE_DEMO_REVIEWERS = "0";
    try {
      const denied = await demoReviewerLogin(
        new Request(`${BASE}/api/session/demo-reviewer`, { method: "POST", body: JSON.stringify({ reviewer: "A" }) }),
      );
      expect(denied.status).toBe(403);
      expect((await postEvidence(evidenceRequest(reviewer, JPEG))).status).toBe(401);
    } finally {
      process.env.POLLTRACE_DEMO_REVIEWERS = "1";
    }
  });
});
