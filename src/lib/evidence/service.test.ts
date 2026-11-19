import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import type { Principal } from "@/lib/auth/session";
import { createLocalStorage } from "@/lib/storage/local";
import type { EvidenceStorage } from "@/lib/storage";
import { createFixedWindowLimiter } from "./rate-limit";
import { AUDIT_EVIDENCE_RECEIVED, sha256HexNode, submitEvidence, type SubmitInput } from "./service";
import { detectImageMime } from "./signature";

// Signature-valid byte strings (NOT decodable photos; only magic bytes are checked).
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);
const JPEG_OTHER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 9, 9, 9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const GIF = new TextEncoder().encode("GIF89a....");
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

const ALICE: Principal = { contributorId: "11111111-1111-4111-8111-111111111111", role: "CONTRIBUTOR", alias: "Anon A", synthetic: false };
const BOB: Principal = { contributorId: "22222222-2222-4222-8222-222222222222", role: "CONTRIBUTOR", alias: "Anon B", synthetic: false };
const CSID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function input(bytes: Uint8Array | null, over: Partial<Record<string, string | undefined>> = {}, principal: Principal | null = ALICE): SubmitInput {
  return {
    principal,
    file: bytes,
    fields: {
      electionId: "demo-election",
      pollingUnitId: "demo-pu-012",
      clientSubmissionId: CSID,
      originalSha256: bytes ? sha256HexNode(bytes) : "0".repeat(64),
      capturedAtClaimed: "2026-11-19T14:05:00.000Z",
      ...over,
    },
  };
}

let dir: string;
let storage: EvidenceStorage;
let ids = 0;
const deps = () => ({
  storage,
  rateLimiter: createFixedWindowLimiter(1000, 60_000),
  now: () => new Date("2026-11-19T15:00:00.000Z"),
  newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
});

async function countObjects(): Promise<number> {
  const walk = async (d: string): Promise<number> => {
    let n = 0;
    for (const ent of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      n += ent.isDirectory() ? await walk(path.join(d, ent.name)) : 1;
    }
    return n;
  };
  return walk(path.join(dir, "objects"));
}
async function db() {
  return JSON.parse(await readFile(path.join(dir, "polltrace-db.json"), "utf8").catch(() => '{"evidence":{},"audit":[]}'));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-svc-"));
  storage = createLocalStorage(dir);
  ids = 0;
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe("submitEvidence rejections (nothing stored)", () => {
  const cases: Array<{ name: string; build: () => SubmitInput; status: number; code: string }> = [
    { name: "no session", build: () => input(JPEG, {}, null), status: 401, code: "UNAUTHENTICATED" },
    { name: "unknown polling unit", build: () => input(JPEG, { pollingUnitId: "demo-pu-999" }), status: 400, code: "UNKNOWN_POLLING_UNIT" },
    { name: "unknown election", build: () => input(JPEG, { electionId: "nope" }), status: 400, code: "UNKNOWN_ELECTION" },
    { name: "clientSubmissionId not uuid", build: () => input(JPEG, { clientSubmissionId: "abc" }), status: 400, code: "INVALID_METADATA" },
    { name: "malformed client hash", build: () => input(JPEG, { originalSha256: "xyz" }), status: 400, code: "INVALID_METADATA" },
    { name: "missing file", build: () => input(null), status: 400, code: "MISSING_FILE" },
    { name: "empty file", build: () => input(new Uint8Array()), status: 400, code: "MISSING_FILE" },
    { name: "GIF magic bytes", build: () => input(GIF), status: 400, code: "UNSUPPORTED_FILE_SIGNATURE" },
    { name: "HTML disguised as image", build: () => input(HTML), status: 400, code: "UNSUPPORTED_FILE_SIGNATURE" },
    {
      name: "oversize",
      build: () => {
        const big = new Uint8Array(MAX_ORIGINAL_BYTES + 1);
        big.set(JPEG);
        return input(big, { originalSha256: "0".repeat(64) });
      },
      status: 413,
      code: "FILE_TOO_LARGE",
    },
    {
      name: "hash mismatch",
      build: () => input(JPEG, { originalSha256: sha256HexNode(JPEG_OTHER) }),
      status: 422,
      code: "HASH_MISMATCH",
    },
  ];

  it.each(cases)("$name -> $status $code", async ({ build, status, code }) => {
    const res = await submitEvidence(build(), deps());
    expect(res.status).toBe(status);
    expect((res.body as { error: { code: string } }).error.code).toBe(code);
    expect(await countObjects()).toBe(0);
    expect(Object.keys((await db()).evidence)).toHaveLength(0);
  });

  it("hash mismatch reports both hashes", async () => {
    const res = await submitEvidence(input(JPEG, { originalSha256: sha256HexNode(JPEG_OTHER) }), deps());
    expect(res.body).toMatchObject({
      error: { clientSha256: sha256HexNode(JPEG_OTHER), serverSha256: sha256HexNode(JPEG) },
    });
  });

  it("accepts uppercase client hash by normalising", async () => {
    const res = await submitEvidence(input(JPEG, { originalSha256: sha256HexNode(JPEG).toUpperCase() }), deps());
    expect(res.status).toBe(201);
  });

  it("rate limit -> 429 with Retry-After", async () => {
    const d = { ...deps(), rateLimiter: createFixedWindowLimiter(1, 60_000) };
    expect((await submitEvidence(input(JPEG), d)).status).toBe(201);
    const res = await submitEvidence(input(JPEG), d);
    expect(res.status).toBe(429);
    expect(res.headers?.["Retry-After"]).toBeDefined();
  });
});

describe("submitEvidence happy path and idempotency", () => {
  it.each([
    ["jpeg", JPEG, "image/jpeg"],
    ["png", PNG, "image/png"],
    ["webp", WEBP, "image/webp"],
  ] as const)("stores %s with server hash, RECEIVED, synthetic", async (_n, bytes, mime) => {
    const res = await submitEvidence(input(bytes), deps());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      sha256: sha256HexNode(bytes),
      receivedAt: "2026-11-19T15:00:00.000Z",
      status: "RECEIVED",
      storageMode: "LOCAL_DEV",
      synthetic: true,
    });
    const rec = (await db()).evidence["00000000-0000-4000-8000-000000000001"];
    expect(rec.mime).toBe(mime);
    expect(rec.sourceType).toBe("WITNESS_PHOTO");
    const stored = await storage.objects.get(rec.originalPath);
    expect(stored && sha256HexNode(stored)).toBe(sha256HexNode(bytes));
  });

  it("identical retry returns the same receipt; one row, one file, one RECEIVED audit", async () => {
    const first = await submitEvidence(input(JPEG), deps());
    const second = await submitEvidence(input(JPEG), deps());
    const third = await submitEvidence(input(JPEG), deps());
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers?.["Idempotent-Replay"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    const d = await db();
    expect(Object.keys(d.evidence)).toHaveLength(1);
    expect(d.audit.filter((a: { eventType: string }) => a.eventType === AUDIT_EVIDENCE_RECEIVED)).toHaveLength(1);
    expect(await countObjects()).toBe(1);
  });

  it("concurrent identical submissions collapse to one record", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => submitEvidence(input(JPEG), deps())));
    const ids = new Set(results.map((r) => (r.body as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const d = await db();
    expect(Object.keys(d.evidence)).toHaveLength(1);
    expect(d.audit).toHaveLength(1);
  });

  it("same clientSubmissionId with different bytes -> 409, original untouched", async () => {
    const first = await submitEvidence(input(JPEG), deps());
    const res = await submitEvidence(input(JPEG_OTHER), deps());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { code: "CLIENT_SUBMISSION_CONFLICT", existingSha256: sha256HexNode(JPEG), receivedSha256: sha256HexNode(JPEG_OTHER) },
    });
    const d = await db();
    expect(Object.keys(d.evidence)).toHaveLength(1);
    const rec = d.evidence[(first.body as { id: string }).id];
    expect(sha256HexNode((await storage.objects.get(rec.originalPath))!)).toBe(sha256HexNode(JPEG));
  });

  it("same clientSubmissionId from a different contributor is a separate submission", async () => {
    const a = await submitEvidence(input(JPEG), deps());
    const b = await submitEvidence(input(JPEG, {}, BOB), deps());
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((a.body as { id: string }).id).not.toBe((b.body as { id: string }).id);
  });

  it("ignores client MIME: detection is by signature only", () => {
    expect(detectImageMime(PNG)).toBe("image/png");
    expect(detectImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF AVI
  });
});

describe("local object store immutability", () => {
  it("never overwrites an existing key with different bytes", async () => {
    const sha = sha256HexNode(JPEG);
    expect(await storage.objects.putImmutable("originals/x/y/a.jpg", JPEG, "image/jpeg", sha)).toBe("CREATED");
    expect(await storage.objects.putImmutable("originals/x/y/a.jpg", JPEG, "image/jpeg", sha)).toBe("ALREADY_PRESENT_IDENTICAL");
    await expect(
      storage.objects.putImmutable("originals/x/y/a.jpg", JPEG_OTHER, "image/jpeg", sha256HexNode(JPEG_OTHER)),
    ).rejects.toThrow(/overwrite/);
    expect(sha256HexNode((await storage.objects.get("originals/x/y/a.jpg"))!)).toBe(sha);
  });

  it("rejects path traversal keys", async () => {
    await expect(storage.objects.putImmutable("../escape.jpg", JPEG, "image/jpeg", "x")).rejects.toThrow(/Invalid object key/);
  });
});
