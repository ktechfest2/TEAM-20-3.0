import { randomUUID } from "node:crypto";
import { getPrincipal, SESSION_COOKIE, sessionCookieHeader, signSessionToken } from "@/lib/auth/session";
import { demoReviewersEnabled } from "@/lib/auth/demo-reviewers";
import { json, serverError } from "@/lib/evidence/http";
import { getStorage } from "@/lib/storage";

const view = (p: { role: string; alias: string; synthetic: boolean }, storageMode: string) => ({
  authenticated: true as const,
  role: p.role,
  alias: p.alias,
  synthetic: p.synthetic,
  storageMode,
});

/** Current session (200 with authenticated:false if none). */
export async function GET(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const p = await getPrincipal(request, storage);
    if (!p) return json(200, { authenticated: false, storageMode: storage.mode, demoReviewersEnabled: demoReviewersEnabled() });
    return json(200, { ...view(p, storage.mode), demoReviewersEnabled: demoReviewersEnabled() });
  } catch (err) {
    return serverError(err);
  }
}

/**
 * Create an anonymous CONTRIBUTOR session. Idempotent: if a valid session already
 * exists it is kept (same contributor id => offline-queue idempotency keys stay valid).
 * Takes no body; the role can never be chosen here.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const existing = await getPrincipal(request, storage);
    if (existing) return json(200, view(existing, storage.mode));

    const id = randomUUID();
    const c = await storage.repo.ensureContributor({
      id,
      alias: `Anonymous contributor ${id.slice(0, 4).toUpperCase()}`,
      role: "CONTRIBUTOR",
      assurance: "UNVERIFIED",
      synthetic: false,
      createdAt: new Date().toISOString(),
    });
    return json(201, view(c, storage.mode), { "Set-Cookie": sessionCookieHeader(signSessionToken(c.id)) });
  } catch (err) {
    return serverError(err);
  }
}

/** Sign out (clears the cookie; the contributor record and its evidence remain). */
export async function DELETE(): Promise<Response> {
  return json(200, { authenticated: false }, {
    "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  });
}
