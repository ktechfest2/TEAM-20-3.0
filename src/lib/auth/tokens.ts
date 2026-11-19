/**
 * Stateless server-signed tokens (HMAC-SHA256 with the session secret), domain-separated
 * so a token minted for one purpose can never be replayed as another (or as a session).
 * Format: "<domain>.<base64url(json)>.<base64url(hmac)>". Payloads are signed, NOT encrypted:
 * never put secrets in them (they hold only ids, a claimed hash and upload metadata).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "./session";

export type TokenDomain = "pi1" /* upload intent */ | "lp1" /* local staging PUT */;

export type VerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED"; payload?: T };

const mac = (domain: string, body: string, secret: Buffer) =>
  createHmac("sha256", secret).update(`${domain}:${body}`).digest();

export function signToken<T extends { exp: number }>(domain: TokenDomain, payload: T, secret = getSessionSecret()): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${domain}.${body}.${mac(domain, body, secret).toString("base64url")}`;
}

/**
 * Verifies signature first; only then decodes. `exp` is unix seconds. On EXPIRED the
 * (authentic) payload is still returned so callers can apply idempotency before expiry.
 */
export function verifyToken<T extends { exp: number }>(
  domain: TokenDomain,
  token: string,
  nowMs = Date.now(),
  secret = getSessionSecret(),
): VerifyResult<T> {
  if (typeof token !== "string" || token.length > 4096) return { ok: false, reason: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== domain) return { ok: false, reason: "MALFORMED" };
  const given = Buffer.from(parts[2], "base64url");
  const expected = mac(domain, parts[1], secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "BAD_SIGNATURE" };
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as T;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (typeof payload?.exp !== "number") return { ok: false, reason: "MALFORMED" };
  if (payload.exp * 1000 <= nowMs) return { ok: false, reason: "EXPIRED", payload };
  return { ok: true, payload };
}
