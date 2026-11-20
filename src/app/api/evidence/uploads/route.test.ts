/**
 * HTTP-level direct upload flow against LOCAL_DEV, exactly as the sync client does it:
 * POST /api/session -> POST /api/evidence/uploads -> PUT uploadUrl -> POST /api/evidence/uploads/finalize.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, beforeEach } from "vitest";
import { MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import { sha256HexNode } from "@/lib/evidence/service";
import { resetStorageForTests } from "@/lib/storage";
import { resetIpLimitersForTests } from "@/lib/evidence/rate-limit";
import { POST as createSession } from "@/app/api/session/route";
import { GET as getEvidence } from "@/app/api/evidence/[id]/route";
import { POST as initRoute } from "./route";
import { POST as finalizeRoute } from "./finalize/route";
import { PUT as localPut } from "./local/[token]/route";

const BASE = "http://localhost:3000";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 1]);

let dir: string;
const savedEnv = { ...process.env };
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-uproute-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "route-test-secret-route-test-secret-0123";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetStorageForTests();
});
afterAll(async () => {
  process.env = savedEnv;
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});

const jsonReq = (url: string, cookie: string | null, body: unknown) =>
  new Request(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => resetIpLimitersForTests());

describe("direct upload over HTTP (LOCAL_DEV)", () => {
  it("session -> init -> PUT -> finalize -> GET; replay; 401 without cookie", async () => {
    const s = await createSession(new Request(`${BASE}/api/session`, { method: "POST" }));
    const cookie = s.headers.get("set-cookie")!.split(";")[0];
    const csid = crypto.randomUUID();
    const meta = {
      electionId: "demo-election",
      pollingUnitId: "demo-pu-012",
      clientSubmissionId: csid,
      originalSha256: sha256HexNode(WEBP),
      sizeBytes: WEBP.byteLength,
      mime: "image/webp",
      sourceType: "OBSERVER_PHOTO",
    };

    expect((await initRoute(jsonReq("/api/evidence/uploads", null, meta))).status).toBe(401);

    const initRes = await initRoute(jsonReq("/api/evidence/uploads", cookie, meta));
    expect(initRes.status).toBe(200);
    const target = await initRes.json();
    expect(target.state).toBe("UPLOAD_REQUIRED");

    // Client PUT: raw bytes, uploadHeaders, no cookie needed.
    const token = target.uploadUrl.split("/").pop();
    const putRes = await localPut(
      new Request(`${BASE}${target.uploadUrl}`, { method: "PUT", headers: target.uploadHeaders, body: new Blob([WEBP]) }),
      { params: Promise.resolve({ token }) },
    );
    expect(putRes.status).toBe(200);

    const fin = await finalizeRoute(
      jsonReq("/api/evidence/uploads/finalize", cookie, { clientSubmissionId: csid, intentToken: target.intentToken }),
    );
    expect(fin.status).toBe(201);
    const receipt = await fin.json();
    expect(receipt).toMatchObject({ sha256: sha256HexNode(WEBP), status: "RECEIVED", storageMode: "LOCAL_DEV", synthetic: true });

    const replay = await finalizeRoute(
      jsonReq("/api/evidence/uploads/finalize", cookie, { clientSubmissionId: csid, intentToken: target.intentToken }),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);

    const view = await (await getEvidence(new Request(`${BASE}/x`, { headers: { cookie } }), { params: Promise.resolve({ id: receipt.id }) })).json();
    expect(view).toMatchObject({ sourceType: "OBSERVER_PHOTO", mime: "image/webp", viewer: "OWNER" });
  });

  it("local PUT: forged grant 403; valid grant + oversize Content-Length 413 before reading", async () => {
    const forged = await localPut(new Request(`${BASE}/x`, { method: "PUT", body: "x" }), {
      params: Promise.resolve({ token: "lp1.e30.AAAA" }),
    });
    expect(forged.status).toBe(403);

    const s = await createSession(new Request(`${BASE}/api/session`, { method: "POST" }));
    const cookie = s.headers.get("set-cookie")!.split(";")[0];
    const target = await (
      await initRoute(
        jsonReq("/api/evidence/uploads", cookie, {
          electionId: "demo-election",
          pollingUnitId: "demo-pu-012",
          clientSubmissionId: crypto.randomUUID(),
          originalSha256: sha256HexNode(WEBP),
          sizeBytes: WEBP.byteLength,
          mime: "image/webp",
        }),
      )
    ).json();
    const res = await localPut(
      new Request(`${BASE}/x`, { method: "PUT", headers: { "content-length": String(MAX_ORIGINAL_BYTES + 1) }, body: "x" }),
      { params: Promise.resolve({ token: target.uploadUrl.split("/").pop() }) },
    );
    expect(res.status).toBe(413);
  });

  it("init rejects oversized JSON body", async () => {
    const s = await createSession(new Request(`${BASE}/api/session`, { method: "POST" }));
    const cookie = s.headers.get("set-cookie")!.split(";")[0];
    const res = await initRoute(jsonReq("/api/evidence/uploads", cookie, { pad: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
  });
});
