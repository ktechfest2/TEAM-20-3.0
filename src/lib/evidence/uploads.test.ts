import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import type { Principal } from "@/lib/auth/session";
import { signToken } from "@/lib/auth/tokens";
import { createLocalStorage } from "@/lib/storage/local";
import type { EvidenceStorage } from "@/lib/storage";
import { createFixedWindowLimiter } from "./rate-limit";
import { sha256HexNode, type SubmitDeps } from "./service";
import {
  FINALIZE_GRACE_MS,
  finalizeUpload,
  initUpload,
  LOCAL_PUT_ROUTE,
  stageLocalUpload,
  stagingKeyFor,
  UPLOAD_WINDOW_MS,
  type UploadIntent,
} from "./uploads";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const PNG_OTHER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 9, 9, 9]);
const NOT_IMAGE = new TextEncoder().encode("%PDF-1.7 not an image");

const ALICE: Principal = { contributorId: "11111111-1111-4111-8111-111111111111", role: "CONTRIBUTOR", alias: "Anon A", synthetic: false };
const MALLORY: Principal = { contributorId: "33333333-3333-4333-8333-333333333333", role: "CONTRIBUTOR", alias: "Anon M", synthetic: false };
const CSID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const T0 = Date.parse("2026-11-19T15:00:00.000Z");

let dir: string;
let storage: EvidenceStorage;
let clock = T0;
let ids = 0;
const deps = (over: Partial<SubmitDeps> = {}): SubmitDeps => ({
  storage,
  rateLimiter: createFixedWindowLimiter(10_000, 60_000),
  now: () => new Date(clock),
  newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  ...over,
});

const initBody = (bytes: Uint8Array, over: Record<string, unknown> = {}) => ({
  electionId: "demo-election",
  pollingUnitId: "demo-pu-012",
  clientSubmissionId: CSID,
  originalSha256: sha256HexNode(bytes),
  capturedAtClaimed: "2026-11-19T14:05:00.000Z",
  sizeBytes: bytes.byteLength,
  mime: "image/png",
  ...over,
});

type InitOk = { state: "UPLOAD_REQUIRED"; uploadUrl: string; uploadHeaders: Record<string, string>; expiresAt: string; intentToken: string; storageMode: string };

async function init(bytes: Uint8Array, over: Record<string, unknown> = {}, p: Principal = ALICE) {
  const r = await initUpload(p, initBody(bytes, over), deps());
  return r;
}
async function initOk(bytes: Uint8Array, over: Record<string, unknown> = {}, p: Principal = ALICE): Promise<InitOk> {
  const r = await init(bytes, over, p);
  expect(r.status).toBe(200);
  expect((r.body as InitOk).state).toBe("UPLOAD_REQUIRED");
  return r.body as InitOk;
}
/** Simulates the client PUT to the LOCAL_DEV same-origin target. */
async function put(target: InitOk, bytes: Uint8Array) {
  expect(target.uploadUrl.startsWith(LOCAL_PUT_ROUTE)).toBe(true);
  const grant = target.uploadUrl.slice(LOCAL_PUT_ROUTE.length);
  return stageLocalUpload(grant, bytes.byteLength, async (max) => (bytes.byteLength > max ? null : bytes), deps());
}
const finalize = (target: InitOk, p: Principal = ALICE, csid = CSID) =>
  finalizeUpload(p, { clientSubmissionId: csid, intentToken: target.intentToken }, deps());

const stagingKey = (p: Principal = ALICE, csid = CSID) => stagingKeyFor(p.contributorId, csid);
const db = async () =>
  JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8").catch(() => '{"evidence":{},"audit":[]}'));
const rowCount = async () => Object.keys((await db()).evidence).length;
async function originalsCount(): Promise<number> {
  const walk = async (d: string): Promise<number> => {
    let n = 0;
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) n += e.isDirectory() ? await walk(path.join(d, e.name)) : 1;
    return n;
  };
  return walk(path.join(dir, "objects", "originals"));
}
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;

const savedSecret = process.env.POLLTRACE_SESSION_SECRET;
beforeAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = "uploads-test-secret-uploads-test-secret-01";
});
afterAll(() => {
  process.env.POLLTRACE_SESSION_SECRET = savedSecret;
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-up-"));
  storage = createLocalStorage(dir);
  clock = T0;
  ids = 0;
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("direct upload happy path", () => {
  it("init -> PUT -> finalize stores original, sourceType, removes staging, one audit", async () => {
    const t = await initOk(PNG, { sourceType: "OBSERVER_PHOTO" });
    expect(t.uploadHeaders).toEqual({ "content-type": "image/png" });
    expect(t.expiresAt).toBe(new Date(T0 + UPLOAD_WINDOW_MS).toISOString());
    expect(t.storageMode).toBe("LOCAL_DEV");
    expect((await put(t, PNG)).status).toBe(200);

    const r = await finalize(t);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      sha256: sha256HexNode(PNG),
      receivedAt: "2026-11-19T15:00:00.000Z",
      status: "RECEIVED",
      storageMode: "LOCAL_DEV",
      synthetic: true,
    });
    const d = await db();
    const rec = d.evidence["00000000-0000-4000-8000-000000000001"];
    expect(rec).toMatchObject({ sourceType: "OBSERVER_PHOTO", mime: "image/png", capturedAtClaimed: "2026-11-19T14:05:00.000Z" });
    expect(rec.originalPath.startsWith("originals/")).toBe(true);
    expect(sha256HexNode((await storage.objects.get(rec.originalPath))!)).toBe(sha256HexNode(PNG));
    expect(await storage.objects.get(stagingKey())).toBeNull();
    expect(d.audit).toHaveLength(1);
    expect(d.audit[0].metadata).toMatchObject({ uploadPath: "DIRECT_STAGED", sourceType: "OBSERVER_PHOTO" });
  });

  it("sourceType defaults to WITNESS_PHOTO", async () => {
    const t = await initOk(PNG);
    await put(t, PNG);
    await finalize(t);
    expect(Object.values((await db()).evidence)[0]).toMatchObject({ sourceType: "WITNESS_PHOTO" });
  });

  it("finalize replay -> 200 same receipt, exactly one row/audit/original", async () => {
    const t = await initOk(PNG);
    await put(t, PNG);
    const first = await finalize(t);
    const again = await finalize(t);
    clock = T0 + 3 * 60 * 60_000; // even after the intent expired
    const late = await finalize(t);
    expect(first.status).toBe(201);
    for (const r of [again, late]) {
      expect(r.status).toBe(200);
      expect(r.headers?.["Idempotent-Replay"]).toBe("true");
      expect(r.body).toEqual(first.body);
    }
    expect(await rowCount()).toBe(1);
    expect((await db()).audit).toHaveLength(1);
    expect(await originalsCount()).toBe(1);
  });

  it("init after received -> ALREADY_RECEIVED with the same receipt", async () => {
    const t = await initOk(PNG);
    await put(t, PNG);
    const first = await finalize(t);
    const r = await init(PNG);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ state: "ALREADY_RECEIVED", receipt: first.body });
  });

  it("re-init while pending re-issues a working target (retry after interrupted PUT)", async () => {
    const t1 = await initOk(PNG);
    await put(t1, PNG.slice(0, 5)); // interrupted / partial
    clock += 60_000;
    const t2 = await initOk(PNG);
    expect(t2.intentToken).not.toBe(t1.intentToken);
    await put(t2, PNG);
    expect((await finalize(t2)).status).toBe(201);
  });

  it("concurrent finalizes collapse to one record", async () => {
    const t = await initOk(PNG);
    await put(t, PNG);
    const rs = await Promise.all([1, 2, 3, 4].map(() => finalize(t)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => (r.body as { id: string }).id)).size).toBe(1);
    expect(await rowCount()).toBe(1);
    expect((await db()).audit).toHaveLength(1);
  });
});

describe("direct upload rejections", () => {
  const rejections: Array<{
    name: string;
    run: () => Promise<{ status: number; body: unknown }>;
    status: number;
    code: string;
    stagingGone?: boolean;
  }> = [
    { name: "init without session", run: () => initUpload(null, initBody(PNG), deps()), status: 401, code: "UNAUTHENTICATED" },
    { name: "finalize without session", run: () => finalizeUpload(null, {}, deps()), status: 401, code: "UNAUTHENTICATED" },
    { name: "unknown PU at init", run: () => init(PNG, { pollingUnitId: "demo-pu-999" }), status: 400, code: "UNKNOWN_POLLING_UNIT" },
    { name: "unknown election at init", run: () => init(PNG, { electionId: "x" }), status: 400, code: "UNKNOWN_ELECTION" },
    { name: "bad sourceType", run: () => init(PNG, { sourceType: "ANONYMOUS_TIP" }), status: 400, code: "INVALID_METADATA" },
    { name: "unsupported declared mime", run: () => init(PNG, { mime: "image/gif" }), status: 400, code: "INVALID_METADATA" },
    { name: "oversize declared", run: () => init(PNG, { sizeBytes: MAX_ORIGINAL_BYTES + 1 }), status: 413, code: "FILE_TOO_LARGE" },
    {
      name: "oversize actual staged",
      run: async () => {
        const t = await initOk(PNG);
        const big = new Uint8Array(MAX_ORIGINAL_BYTES + 1);
        big.set(PNG);
        await storage.objects.putStaging(stagingKey(), big, "image/png"); // as if bucket limit were bypassed
        return finalize(t);
      },
      status: 413,
      code: "FILE_TOO_LARGE",
      stagingGone: true,
    },
    {
      name: "oversize local PUT",
      run: async () => {
        const t = await initOk(PNG);
        return put(t, new Uint8Array(MAX_ORIGINAL_BYTES + 1));
      },
      status: 413,
      code: "FILE_TOO_LARGE",
    },
    {
      name: "hash mismatch (tampered staged bytes)",
      run: async () => {
        const t = await initOk(PNG);
        await put(t, PNG_OTHER);
        return finalize(t);
      },
      status: 422,
      code: "HASH_MISMATCH",
      stagingGone: true,
    },
    {
      name: "bad magic bytes",
      run: async () => {
        const t = await initOk(NOT_IMAGE);
        await put(t, NOT_IMAGE);
        return finalize(t);
      },
      status: 400,
      code: "UNSUPPORTED_FILE_SIGNATURE",
      stagingGone: true,
    },
    {
      name: "finalize without init (garbage token)",
      run: () => finalizeUpload(ALICE, { clientSubmissionId: CSID, intentToken: "pi1.e30.AAAA" }, deps()),
      status: 404,
      code: "UPLOAD_INTENT_NOT_FOUND",
    },
    {
      name: "forged intent token (wrong key)",
      run: () =>
        finalizeUpload(
          ALICE,
          {
            clientSubmissionId: CSID,
            intentToken: signToken<UploadIntent>(
              "pi1",
              { exp: 9e9, cid: ALICE.contributorId, csid: CSID, sha: sha256HexNode(PNG), size: 1, mime: "image/png", eid: "demo-election", puid: "demo-pu-012", src: "WITNESS_PHOTO", cap: null, key: stagingKey() },
              Buffer.from("attacker-secret-attacker-secret-attacker"),
            ),
          },
          deps(),
        ),
      status: 404,
      code: "UPLOAD_INTENT_NOT_FOUND",
    },
    {
      name: "token for another clientSubmissionId",
      run: async () => finalize(await initOk(PNG), ALICE, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      status: 404,
      code: "UPLOAD_INTENT_NOT_FOUND",
    },
    {
      name: "other contributor's submission",
      run: async () => {
        const t = await initOk(PNG);
        await put(t, PNG);
        return finalize(t, MALLORY);
      },
      status: 404,
      code: "UPLOAD_INTENT_NOT_FOUND",
    },
    {
      name: "session token replayed as intent token",
      run: () => finalizeUpload(ALICE, { clientSubmissionId: CSID, intentToken: "v1.abc.def" }, deps()),
      status: 404,
      code: "UPLOAD_INTENT_NOT_FOUND",
    },
    {
      name: "expired intent token",
      run: async () => {
        const t = await initOk(PNG);
        await put(t, PNG);
        clock = T0 + UPLOAD_WINDOW_MS + FINALIZE_GRACE_MS + 1000;
        return finalize(t);
      },
      status: 410,
      code: "UPLOAD_INTENT_EXPIRED",
      stagingGone: true,
    },
    {
      name: "expired local PUT grant",
      run: async () => {
        const t = await initOk(PNG);
        clock = T0 + UPLOAD_WINDOW_MS + 1000;
        return put(t, PNG);
      },
      status: 410,
      code: "UPLOAD_GRANT_EXPIRED",
    },
    {
      name: "tampered local PUT grant",
      run: () => stageLocalUpload("lp1.e30.AAAA", 3, async () => PNG, deps()),
      status: 403,
      code: "INVALID_UPLOAD_GRANT",
    },
    {
      name: "finalize before PUT",
      run: async () => finalize(await initOk(PNG)),
      status: 409,
      code: "UPLOAD_INCOMPLETE",
    },
    {
      name: "local PUT route disabled in SUPABASE mode",
      run: async () => {
        const t = await initOk(PNG);
        return stageLocalUpload(t.uploadUrl.slice(LOCAL_PUT_ROUTE.length), 3, async () => PNG, deps({ storage: { ...storage, mode: "SUPABASE" } }));
      },
      status: 404,
      code: "NOT_FOUND",
    },
  ];

  it.each(rejections)("$name -> $status $code (no row stored)", async ({ run, status, code: c, stagingGone }) => {
    const r = await run();
    expect(r.status).toBe(status);
    expect(code(r)).toBe(c);
    expect(await rowCount()).toBe(0);
    expect(await originalsCount()).toBe(0);
    if (stagingGone) expect(await storage.objects.get(stagingKey())).toBeNull();
  });

  it("hash mismatch reports both hashes", async () => {
    const t = await initOk(PNG);
    await put(t, PNG_OTHER);
    expect((await finalize(t)).body).toMatchObject({
      error: { clientSha256: sha256HexNode(PNG), serverSha256: sha256HexNode(PNG_OTHER) },
    });
  });

  it("conflicting reuse after receipt -> 409 at init", async () => {
    const t = await initOk(PNG);
    await put(t, PNG);
    await finalize(t);
    const r = await init(PNG_OTHER);
    expect(r.status).toBe(409);
    expect(code(r)).toBe("CLIENT_SUBMISSION_CONFLICT");
  });

  it("conflicting reuse while pending -> second finalize 409, first original untouched", async () => {
    const tA = await initOk(PNG);
    const tB = await initOk(PNG_OTHER);
    await put(tA, PNG);
    expect((await finalize(tA)).status).toBe(201);
    await put(tB, PNG_OTHER);
    const r = await finalize(tB);
    expect(r.status).toBe(409);
    expect(code(r)).toBe("CLIENT_SUBMISSION_CONFLICT");
    expect(await rowCount()).toBe(1);
    const rec = Object.values((await db()).evidence)[0] as { originalPath: string };
    expect(sha256HexNode((await storage.objects.get(rec.originalPath))!)).toBe(sha256HexNode(PNG));
    expect(await storage.objects.get(stagingKey())).toBeNull();
  });

  it("staging helpers refuse to touch originals", async () => {
    await expect(storage.objects.removeStaging("originals/x/y/z.png")).rejects.toThrow(/non-staging/);
    await expect(storage.objects.putStaging("originals/x/y/z.png", PNG, "image/png")).rejects.toThrow(/non-staging/);
  });
});
