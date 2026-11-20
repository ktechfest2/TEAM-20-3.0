import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollTraceDB, saveCapture } from "./db";
import { sha256Hex } from "./hash";
import { MAX_AUTO_ATTEMPTS, recoverInterruptedUploads, syncAll, uploadCapture } from "./sync";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const blob = () => new Blob([PNG], { type: "image/png" });
const input = {
  fileName: "sheet.png",
  electionId: "demo-election",
  pollingUnitId: "demo-pu-012",
  sourceType: "OBSERVER_PHOTO" as const,
  synthetic: true,
};

let db: PollTraceDB;
beforeEach(() => {
  db = new PollTraceDB(`t-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
});

const receiptFor = (sha256: string) => ({
  id: crypto.randomUUID(),
  sha256,
  receivedAt: new Date().toISOString(),
  status: "RECEIVED",
});

const UPLOAD_URL = "https://storage.example.test/upload/sign/staging/x";

/** Fake 3-step server. Override any step's response; records every call. */
function fakeServer(
  sha: string,
  over: Partial<Record<"session" | "init" | "put" | "finalize", () => Response | Promise<Response>>> = {},
) {
  const calls: Array<{ step: string; init?: RequestInit }> = [];
  const steps = {
    session: () => new Response(null, { status: 201 }),
    init: () =>
      Response.json({
        state: "UPLOAD_REQUIRED",
        uploadUrl: UPLOAD_URL,
        uploadHeaders: { "content-type": "image/png", "x-upsert": "true" },
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        intentToken: "signed-intent",
        storageMode: "SUPABASE",
      }),
    put: () => new Response(null, { status: 200 }),
    finalize: () => Response.json(receiptFor(sha), { status: 201 }),
    ...over,
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const step =
      url === "/api/session"
        ? "session"
        : url === "/api/evidence/uploads"
          ? "init"
          : url === "/api/evidence/uploads/finalize"
            ? "finalize"
            : url === UPLOAD_URL
              ? "put"
              : "unknown";
    calls.push({ step, init });
    if (step === "unknown") throw new Error(`unexpected ${url}`);
    return steps[step]();
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("saveCapture", () => {
  it("persists original bytes, hash, role and a stable id before reporting success", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    expect(rec.status).toBe("SAVED_LOCAL");
    expect(rec.sha256).toBe(await sha256Hex(PNG));
    expect(rec.sourceType).toBe("OBSERVER_PHOTO");
    expect(rec.serverReceipt).toBeNull();
    // A fresh connection (simulates a page refresh) still finds identical bytes.
    const reopened = new PollTraceDB(db.name);
    const again = await reopened.captures.get(rec.id);
    expect(again?.sha256).toBe(rec.sha256);
    // Stored as raw bytes (ArrayBuffer), never as a Blob/File reference: iOS Safari loses File
    // references kept in IndexedDB ("This photo can no longer be read on this device").
    expect(again!.bytes).toBeInstanceOf(ArrayBuffer);
    expect(again!.blob).toBeUndefined();
    expect(new Uint8Array(again!.bytes!)).toEqual(PNG);
    reopened.close();
  });

  it("gives each capture its own clientSubmissionId", async () => {
    const a = await saveCapture({ ...input, blob: blob() }, db);
    const b = await saveCapture({ ...input, blob: blob() }, db);
    expect(a.id).not.toBe(b.id);
    expect(a.sha256).toBe(b.sha256);
  });
});

describe("direct-to-storage sync", () => {
  it("runs init → PUT → finalize once and marks RECEIVED on a matching receipt", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    const calls = fakeServer(rec.sha256);
    await syncAll(false, db);
    await syncAll(false, db); // must not re-upload a received capture
    const after = await db.captures.get(rec.id);
    expect(after?.status).toBe("RECEIVED");
    expect(after?.serverReceipt?.sha256).toBe(rec.sha256);
    expect(calls.map((c) => c.step)).toEqual(["init", "put", "finalize"]);

    const initBody = JSON.parse(String(calls[0].init?.body));
    expect(initBody).toMatchObject({
      clientSubmissionId: rec.id,
      originalSha256: rec.sha256,
      sizeBytes: PNG.length,
      mime: "image/png",
      sourceType: "OBSERVER_PHOTO",
    });
    // PUT sends exactly the given headers, the raw blob, and no cookies.
    expect(calls[1].init?.headers).toEqual({ "content-type": "image/png", "x-upsert": "true" });
    expect(calls[1].init?.credentials).toBe("omit");
    expect(calls[1].init?.body).toBeInstanceOf(Blob);
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      clientSubmissionId: rec.id,
      intentToken: "signed-intent",
    });
  });

  it("accepts ALREADY_RECEIVED at init without uploading again", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    const calls = fakeServer(rec.sha256, {
      init: () => Response.json({ state: "ALREADY_RECEIVED", receipt: receiptFor(rec.sha256) }),
    });
    await uploadCapture(rec.id, db);
    expect((await db.captures.get(rec.id))?.status).toBe("RECEIVED");
    expect(calls.map((c) => c.step)).toEqual(["init"]);
  });

  it("flags a server receipt with a different hash instead of accepting it", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    fakeServer(rec.sha256, { finalize: () => Response.json(receiptFor("0".repeat(64)), { status: 201 }) });
    await uploadCapture(rec.id, db);
    const after = await db.captures.get(rec.id);
    expect(after).toMatchObject({ status: "NEEDS_ATTENTION", lastError: "HASH_MISMATCH", serverReceipt: null });
    expect(after?.bytes?.byteLength).toBe(PNG.length); // original never deleted
  });

  it.each([
    ["init", 409, undefined, "CONFLICT"],
    ["init", 413, undefined, "REJECTED_FILE"],
    ["init", 403, undefined, "UNAUTHORIZED"],
    ["finalize", 422, "HASH_MISMATCH", "HASH_MISMATCH"],
    ["finalize", 400, "UNSUPPORTED_FILE_SIGNATURE", "REJECTED_FILE"],
    ["finalize", 409, "CLIENT_SUBMISSION_CONFLICT", "CONFLICT"],
    ["put", 413, undefined, "REJECTED_FILE"],
  ] as const)("%s HTTP %i (%s) → NEEDS_ATTENTION/%s", async (step, status, code, reason) => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    fakeServer(rec.sha256, { [step]: () => Response.json({ error: { code } }, { status }) });
    await uploadCapture(rec.id, db);
    expect(await db.captures.get(rec.id)).toMatchObject({ status: "NEEDS_ATTENTION", lastError: reason });
  });

  it.each([
    ["put", 500, undefined],
    ["finalize", 409, "UPLOAD_INCOMPLETE"],
    ["finalize", 410, "UPLOAD_INTENT_EXPIRED"],
    ["finalize", 503, undefined],
  ] as const)("%s HTTP %i (%s) is retryable: stays SAVED_LOCAL", async (step, status, code) => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    fakeServer(rec.sha256, { [step]: () => Response.json({ error: { code } }, { status }) });
    await uploadCapture(rec.id, db);
    expect(await db.captures.get(rec.id)).toMatchObject({ status: "SAVED_LOCAL", lastError: "NETWORK" });
  });

  it("gets a session on 401 and retries with the same clientSubmissionId", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    let first = true;
    const calls = fakeServer(rec.sha256, {
      init: () => {
        if (first) {
          first = false;
          return new Response(null, { status: 401 });
        }
        return Response.json({
          state: "UPLOAD_REQUIRED",
          uploadUrl: UPLOAD_URL,
          uploadHeaders: { "content-type": "image/png" },
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          intentToken: "signed-intent",
          storageMode: "LOCAL_DEV",
        });
      },
    });
    await uploadCapture(rec.id, db);
    expect((await db.captures.get(rec.id))?.status).toBe("RECEIVED");
    expect(calls.map((c) => c.step)).toEqual(["init", "session", "init", "put", "finalize"]);
    const ids = calls
      .filter((c) => c.step === "init")
      .map((c) => JSON.parse(String(c.init?.body)).clientSubmissionId);
    expect(new Set(ids)).toEqual(new Set([rec.id]));
  });

  it(`stays SAVED_LOCAL on network failure, then needs attention after ${MAX_AUTO_ATTEMPTS} tries`, async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    for (let i = 1; i < MAX_AUTO_ATTEMPTS; i++) {
      await uploadCapture(rec.id, db);
      expect((await db.captures.get(rec.id))?.status).toBe("SAVED_LOCAL");
    }
    await uploadCapture(rec.id, db);
    expect(await db.captures.get(rec.id)).toMatchObject({ status: "NEEDS_ATTENTION", lastError: "NETWORK" });
  });

  it("refuses an unsupported file type locally without calling the server", async () => {
    const rec = await saveCapture({ ...input, blob: new Blob([PNG], { type: "image/heic" }) }, db);
    const calls = fakeServer(rec.sha256);
    await uploadCapture(rec.id, db);
    expect(await db.captures.get(rec.id)).toMatchObject({ status: "NEEDS_ATTENTION", lastError: "REJECTED_FILE" });
    expect(calls).toHaveLength(0);
  });

  it.each(["init", "finalize"] as const)(
    "403 REVIEWER_SESSION at %s leaves captures SAVED_LOCAL without error and stops syncAll",
    async (step) => {
      const a = await saveCapture({ ...input, blob: blob() }, db);
      const b = await saveCapture({ ...input, blob: new Blob([PNG, PNG], { type: "image/png" }) }, db);
      const refused = () =>
        Response.json(
          { error: { code: "REVIEWER_SESSION", message: "This is a reviewer session." } },
          { status: 403 },
        );
      const calls = fakeServer(a.sha256, { [step]: refused });
      await syncAll(true, db);
      for (const id of [a.id, b.id]) {
        expect(await db.captures.get(id)).toMatchObject({ status: "SAVED_LOCAL", lastError: null, attempts: 0 });
      }
      // Stopped after the first refusal: only one capture was tried.
      expect(calls.filter((c) => c.step === "init")).toHaveLength(1);
    },
  );

  it("a plain 403 (not a reviewer session) still needs attention", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    fakeServer(rec.sha256, { init: () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }) });
    await uploadCapture(rec.id, db);
    expect(await db.captures.get(rec.id)).toMatchObject({ status: "NEEDS_ATTENTION", lastError: "UNAUTHORIZED" });
  });

  it("recovers an upload interrupted by a closed tab", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    await db.captures.update(rec.id, { status: "UPLOADING" });
    await recoverInterruptedUploads(db);
    expect((await db.captures.get(rec.id))?.status).toBe("SAVED_LOCAL");
  });
});
