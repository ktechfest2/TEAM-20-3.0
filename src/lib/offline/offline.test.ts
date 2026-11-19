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

describe("saveCapture", () => {
  it("persists original bytes, hash and a stable id before reporting success", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    expect(rec.status).toBe("SAVED_LOCAL");
    expect(rec.sha256).toBe(await sha256Hex(PNG));
    expect(rec.serverReceipt).toBeNull();
    // A fresh connection (simulates a page refresh) still finds identical bytes.
    const reopened = new PollTraceDB(db.name);
    const again = await reopened.captures.get(rec.id);
    expect(again?.sha256).toBe(rec.sha256);
    expect(new Uint8Array(await again!.blob.arrayBuffer())).toEqual(PNG);
    reopened.close();
  });

  it("gives each capture its own clientSubmissionId", async () => {
    const a = await saveCapture({ ...input, blob: blob() }, db);
    const b = await saveCapture({ ...input, blob: blob() }, db);
    expect(a.id).not.toBe(b.id);
    expect(a.sha256).toBe(b.sha256);
  });
});

describe("sync", () => {
  it("marks RECEIVED only when the server receipt hash matches, and uploads once", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    // Typed (url, init) so tests can read the posted FormData from mock.calls.
    const fetchMock = vi.fn(async (...[url]: [string, RequestInit?]) =>
      url === "/api/evidence"
        ? Response.json(receiptFor(rec.sha256), { status: 201 })
        : new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await syncAll(false, db);
    await syncAll(false, db); // second run must not re-upload a received capture
    const after = await db.captures.get(rec.id);
    expect(after?.status).toBe("RECEIVED");
    expect(after?.serverReceipt?.sha256).toBe(rec.sha256);
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/evidence")).toHaveLength(1);
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get("clientSubmissionId")).toBe(rec.id);
    expect(form.get("originalSha256")).toBe(rec.sha256);
    expect(form.get("sourceType")).toBe("OBSERVER_PHOTO");
  });

  it("flags a server receipt with a different hash instead of accepting it", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(receiptFor("0".repeat(64)), { status: 201 })));
    await uploadCapture(rec.id, db);
    const after = await db.captures.get(rec.id);
    expect(after?.status).toBe("NEEDS_ATTENTION");
    expect(after?.lastError).toBe("HASH_MISMATCH");
    expect(after?.blob.size).toBe(PNG.length); // original never deleted
  });

  it.each([
    [409, "CONFLICT"],
    [422, "HASH_MISMATCH"],
    [400, "REJECTED_FILE"],
    [403, "UNAUTHORIZED"],
  ])("maps HTTP %i to NEEDS_ATTENTION/%s", async (status, reason) => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "X" } }, { status })));
    await uploadCapture(rec.id, db);
    const after = await db.captures.get(rec.id);
    expect(after).toMatchObject({ status: "NEEDS_ATTENTION", lastError: reason, serverReceipt: null });
  });

  it("gets a session on 401 and retries with the same clientSubmissionId", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    let evidenceCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/session") return new Response(null, { status: 201 });
      evidenceCalls += 1;
      return evidenceCalls === 1
        ? new Response(null, { status: 401 })
        : Response.json(receiptFor(rec.sha256), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await uploadCapture(rec.id, db);
    expect((await db.captures.get(rec.id))?.status).toBe("RECEIVED");
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["/api/evidence", "/api/session", "/api/evidence"]);
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

  it("recovers an upload interrupted by a closed tab", async () => {
    const rec = await saveCapture({ ...input, blob: blob() }, db);
    await db.captures.update(rec.id, { status: "UPLOADING" });
    await recoverInterruptedUploads(db);
    expect((await db.captures.get(rec.id))?.status).toBe("SAVED_LOCAL");
  });
});
