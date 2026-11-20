/** Session + demo-reviewer sign-in hardening (LOCAL_DEV). */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetIpLimitersForTests } from "@/lib/evidence/rate-limit";
import { resetStorageForTests } from "@/lib/storage";
import { POST as postEvidence } from "@/app/api/evidence/route";
import { GET as getSession, POST as createSession } from "./route";
import { POST as reviewerLogin } from "./demo-reviewer/route";

const BASE = "http://localhost:3000";
let dir: string;
const savedEnv = { ...process.env };
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "polltrace-sess-"));
  process.env.POLLTRACE_LOCAL_DATA_DIR = dir;
  process.env.POLLTRACE_SESSION_SECRET = "session-route-secret-session-route-0001";
  process.env.POLLTRACE_DEMO_REVIEWERS = "1";
  process.env.POLLTRACE_DEMO_REVIEWER_PASSCODE = "reviewer-pass-123";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetStorageForTests();
});
afterAll(async () => {
  process.env = savedEnv;
  resetStorageForTests();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  resetIpLimitersForTests();
  (globalThis as { __polltraceReviewerLoginFailures?: unknown }).__polltraceReviewerLoginFailures = undefined;
});

const newSession = (ip: string, cookie?: string) =>
  createSession(new Request(`${BASE}/api/session`, { method: "POST", headers: { "x-vercel-forwarded-for": ip, ...(cookie ? { cookie } : {}) } }));
const login = (ip: string, passcode: string) =>
  reviewerLogin(
    new Request(`${BASE}/api/session/demo-reviewer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip },
      body: JSON.stringify({ reviewer: "A", passcode }),
    }),
  );

describe("POST /api/session limits", () => {
  it("10 new sessions per IP per minute, then 429; existing sessions are not counted; other IPs fine", async () => {
    let cookie = "";
    for (let i = 0; i < 10; i++) {
      const r = await newSession("203.0.113.5");
      expect(r.status).toBe(201);
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    }
    const blocked = await newSession("203.0.113.5");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await newSession("203.0.113.5", cookie)).status).toBe(200); // reuse, no new contributor
    expect((await newSession("203.0.113.6")).status).toBe(201);
  });
});

describe("malformed session cookie", () => {
  it.each(["pt_session=%E0%A4%A", "pt_session=%", "pt_session=v1.%ZZ.x"])("%s -> treated as no session (no 500)", async (cookie) => {
    const s = await getSession(new Request(`${BASE}/api/session`, { headers: { cookie } }));
    expect(s.status).toBe(200);
    expect((await s.json()).authenticated).toBe(false);
    const up = await postEvidence(new Request(`${BASE}/api/evidence`, { method: "POST", headers: { cookie }, body: new FormData() }));
    expect(up.status).toBe(401);
  });
});

describe("demo reviewer sign-in lockout", () => {
  it("5 wrong passcodes from one IP -> 429 even with the right one; other IP still signs in", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await login("198.51.100.20", `wrong-${i}`);
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("DEMO_REVIEWER_PASSCODE_INVALID");
    }
    expect((await login("198.51.100.20", "reviewer-pass-123")).status).toBe(429);
    expect((await login("198.51.100.21", "reviewer-pass-123")).status).toBe(200);
  });

  it("global cap: 30 wrong passcodes across 30 IPs lock new IPs too", async () => {
    for (let i = 0; i < 30; i++) expect((await login(`192.0.2.${i}`, "wrong")).status).toBe(403);
    expect((await login("192.0.2.200", "reviewer-pass-123")).status).toBe(429);
  });
});
