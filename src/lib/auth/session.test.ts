import { describe, expect, it } from "vitest";
import { getSessionSecret, readCookie, signSessionToken, verifySessionToken } from "./session";
import { demoReviewerLoginDenied } from "./demo-reviewers";
import { resolveStorageMode } from "@/lib/storage";

const SECRET = Buffer.from("x".repeat(40));
const OTHER = Buffer.from("y".repeat(40));
const ID = "11111111-1111-4111-8111-111111111111";

describe("session token", () => {
  it("round-trips", () => {
    expect(verifySessionToken(signSessionToken(ID, 0, SECRET), 1000, SECRET)).toBe(ID);
  });
  it.each([
    ["wrong secret", () => verifySessionToken(signSessionToken(ID, 0, SECRET), 1000, OTHER)],
    ["expired", () => verifySessionToken(signSessionToken(ID, 0, SECRET), 31 * 24 * 3600 * 1000, SECRET)],
    ["garbage", () => verifySessionToken("v1.abc", 0, SECRET)],
    [
      "tampered payload",
      () => {
        const [v, , sig] = signSessionToken(ID, 0, SECRET).split(".");
        const forged = Buffer.from(JSON.stringify({ sub: "attacker", iat: 0, exp: 9e9 })).toString("base64url");
        return verifySessionToken(`${v}.${forged}.${sig}`, 0, SECRET);
      },
    ],
  ])("rejects %s", (_n, fn) => expect(fn()).toBeNull());

  it("parses cookie header", () => {
    const req = new Request("http://x", { headers: { cookie: "a=1; pt_session=abc.def; b=2" } });
    expect(readCookie(req, "pt_session")).toBe("abc.def");
  });

  it("requires a secret in production", () => {
    expect(() => getSessionSecret({ NODE_ENV: "production" })).toThrow(/required/);
    expect(() => getSessionSecret({ POLLTRACE_SESSION_SECRET: "short" })).toThrow(/32/);
  });
});

describe("demo reviewer gate", () => {
  it.each([
    [{}, undefined, false],
    [{ POLLTRACE_DEMO_REVIEWERS: "1" }, undefined, true],
    [{ POLLTRACE_DEMO_REVIEWERS: "1", NODE_ENV: "production" }, undefined, false],
    [{ POLLTRACE_DEMO_REVIEWERS: "1", NODE_ENV: "production", POLLTRACE_DEMO_REVIEWER_PASSCODE: "pw" }, "pw", true],
    [{ POLLTRACE_DEMO_REVIEWERS: "1", POLLTRACE_DEMO_REVIEWER_PASSCODE: "pw" }, "nope", false],
  ] as const)("env %o passcode %s -> allowed %s", (env, pass, allowed) => {
    expect(demoReviewerLoginDenied(pass, env) === null).toBe(allowed);
  });
});

describe("storage mode selection", () => {
  it.each([
    [{}, "LOCAL_DEV"],
    [{ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }, "SUPABASE"],
    [{ NODE_ENV: "production", POLLTRACE_ALLOW_LOCAL_STORE: "1" }, "LOCAL_DEV"],
  ] as const)("%o -> %s", (env, mode) => expect(resolveStorageMode(env)).toBe(mode));

  it.each([
    [{ NODE_ENV: "production" }],
    [{ SUPABASE_SERVICE_ROLE_KEY: "k" }],
  ])("refuses %o", (env) => expect(() => resolveStorageMode(env)).toThrow());
});
