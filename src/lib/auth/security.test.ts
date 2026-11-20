import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";
import { createPasscodeGuard } from "./passcode-guard";
import { readCookie } from "./session";

const req = (headers: Record<string, string>) => new Request("http://x", { headers });

describe("clientIp", () => {
  it.each([
    [{ "x-vercel-forwarded-for": "198.51.100.1", "x-real-ip": "1.1.1.1", "x-forwarded-for": "6.6.6.6" }, "198.51.100.1"],
    [{ "x-vercel-forwarded-for": "198.51.100.1, 10.0.0.1" }, "198.51.100.1"],
    [{ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }, "203.0.113.9"],
    [{ "x-forwarded-for": "6.6.6.6, 10.0.0.2" }, "10.0.0.2"], // spoofable leftmost ignored
    [{ "x-forwarded-for": "6.6.6.6" }, "6.6.6.6"],
    [{}, "unknown"],
  ])("%o -> %s", (headers, ip) => expect(clientIp(req(headers))).toBe(ip));
});

describe("passcode guard", () => {
  it("5 failures per IP lock that IP only", () => {
    const g = createPasscodeGuard(5, 30, 60_000);
    for (let i = 0; i < 5; i++) g.recordFailure("a", 0);
    expect(g.blockedFor("a", 1000)).toBeGreaterThan(0);
    expect(g.blockedFor("b", 1000)).toBe(0);
    expect(g.blockedFor("a", 61_000)).toBe(0); // window passes
  });
  it("global cap: 30 failures spread over many IPs lock everyone", () => {
    const g = createPasscodeGuard(5, 30, 60_000);
    for (let i = 0; i < 30; i++) g.recordFailure(`ip-${i}`, 0);
    expect(g.blockedFor("fresh-ip", 1000)).toBeGreaterThan(0);
  });
});

describe("readCookie", () => {
  it.each(["pt_session=%E0%A4%A", "pt_session=%", "a=1; pt_session=%ZZ"])("malformed encoding %s -> null, no throw", (cookie) => {
    expect(readCookie(req({ cookie }), "pt_session")).toBeNull();
  });
});
