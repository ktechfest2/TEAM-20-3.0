/**
 * Minimal P0 server session (server-only). Replaceable by Supabase Auth later:
 * everything else calls `getPrincipal(request)` and nothing reads the cookie directly.
 *
 * Cookie `pt_session` = "v1.<base64url(json{sub,iat,exp})>.<base64url(HMAC-SHA256)>",
 * httpOnly, SameSite=Lax, Path=/, Secure in production. It holds ONLY a contributor id.
 * The role is NEVER taken from the cookie or the client; it is looked up server-side.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getStorage, localDataDir, type ContributorRecord, type EvidenceStorage } from "@/lib/storage";
import { demoReviewersEnabled, isDemoReviewerId } from "./demo-reviewers";

export const SESSION_COOKIE = "pt_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days: offline queues can be old

export interface Principal {
  contributorId: string;
  role: ContributorRecord["role"];
  alias: string;
  synthetic: boolean;
}

type Env = Record<string, string | undefined>;
const g = globalThis as unknown as { __polltraceSessionSecret?: Buffer };

/** Production: POLLTRACE_SESSION_SECRET required (>= 32 chars). Dev: persisted random secret. */
export function getSessionSecret(env: Env = process.env): Buffer {
  const configured = env.POLLTRACE_SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("POLLTRACE_SESSION_SECRET must be at least 32 characters");
    return Buffer.from(configured, "utf8");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("POLLTRACE_SESSION_SECRET is required in production");
  }
  if (g.__polltraceSessionSecret) return g.__polltraceSessionSecret;
  // Dev only: persist next to LOCAL_DEV data so sessions survive dev-server restarts
  // (otherwise an offline queue would re-upload under a new contributor id).
  const file = path.join(localDataDir(env), ".session-secret");
  let secret: Buffer;
  try {
    secret = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
    if (secret.length < 32) throw new Error("short");
  } catch {
    secret = randomBytes(32);
    try {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
    } catch {
      /* per-process secret only */
    }
  }
  console.warn("[polltrace] POLLTRACE_SESSION_SECRET not set; using a generated DEV-ONLY session secret.");
  g.__polltraceSessionSecret = secret;
  return secret;
}

const b64url = (b: Buffer) => b.toString("base64url");
const sign = (payload: string, secret: Buffer) => createHmac("sha256", secret).update(payload).digest();

export function signSessionToken(contributorId: string, nowMs = Date.now(), secret = getSessionSecret()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ sub: contributorId, iat, exp: iat + SESSION_TTL_SECONDS })));
  return `v1.${payload}.${b64url(sign(`v1.${payload}`, secret))}`;
}

/** Returns the contributor id or null. Constant-time signature comparison. */
export function verifySessionToken(token: string, nowMs = Date.now(), secret = getSessionSecret()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = sign(`v1.${parts[1]}`, secret);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof body.sub !== "string" || typeof body.exp !== "number") return null;
    if (body.exp * 1000 <= nowMs) return null;
    return body.sub;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookieHeader(token: string, env: Env = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

/** The single auth seam. Swap internals for Supabase Auth later. */
export async function getPrincipal(
  request: Request,
  storage: EvidenceStorage = getStorage(),
): Promise<Principal | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const contributorId = verifySessionToken(token);
  if (!contributorId) return null;
  const c = await storage.repo.getContributor(contributorId);
  if (!c) return null;
  // Demo reviewer identities stop working the moment the flag is off.
  if (isDemoReviewerId(c.id) && !demoReviewersEnabled()) return null;
  return { contributorId: c.id, role: c.role, alias: c.alias, synthetic: c.synthetic };
}

/** Opaque, stable pseudonym for a contributor (lets reviewers spot same-source submissions without the alias). */
export function contributorRef(contributorId: string): string {
  return createHmac("sha256", getSessionSecret()).update(`ref:${contributorId}`).digest("hex").slice(0, 12);
}

/** Opaque, stable per-reviewer reference for review events (never the identity or alias). */
export function reviewerRef(reviewerId: string): string {
  return createHmac("sha256", getSessionSecret()).update(`reviewer:${reviewerId}`).digest("hex").slice(0, 12);
}
