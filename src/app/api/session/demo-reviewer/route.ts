import { z } from "zod";
import { clientIp } from "@/lib/auth/client-ip";
import { DEMO_REVIEWERS, demoReviewerLoginDenied, INVALID_REVIEWER_PASSCODE } from "@/lib/auth/demo-reviewers";
import { reviewerLoginGuard } from "@/lib/auth/passcode-guard";
import { sessionCookieHeader, signSessionToken } from "@/lib/auth/session";
import { json, readJsonCapped, serverError } from "@/lib/evidence/http";
import { errorBody } from "@/lib/evidence/service";
import { getStorage } from "@/lib/storage";

const Body = z.object({ reviewer: z.enum(["A", "B"]), passcode: z.string().max(200).optional() });

/**
 * Sign in as a SYNTHETIC demo reviewer. Disabled (403) unless POLLTRACE_DEMO_REVIEWERS=1;
 * in production also requires POLLTRACE_DEMO_REVIEWER_PASSCODE. Wrong passcodes are locked out
 * per IP (5/min) and globally (30/min) -> 429. Replaces the current session cookie.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const guard = reviewerLoginGuard();
    const ip = clientIp(request);
    const wait = guard.blockedFor(ip);
    if (wait > 0) {
      return json(429, errorBody("RATE_LIMITED", "Too many wrong passcodes. Try again shortly."), { "Retry-After": String(wait) });
    }
    const raw = await readJsonCapped(request);
    if (!raw.ok) return raw.response;
    const parsed = Body.safeParse(raw.value);
    if (!parsed.success) return json(400, errorBody("INVALID_REQUEST", "Expected { reviewer: 'A' | 'B', passcode? }."));

    const denied = demoReviewerLoginDenied(parsed.data.passcode);
    if (denied === INVALID_REVIEWER_PASSCODE) {
      guard.recordFailure(ip);
      return json(403, errorBody("DEMO_REVIEWER_PASSCODE_INVALID", denied));
    }
    if (denied) return json(403, errorBody("DEMO_REVIEWERS_DISABLED", denied));

    const template = DEMO_REVIEWERS[parsed.data.reviewer === "A" ? 0 : 1];
    const storage = getStorage();
    const c = await storage.repo.ensureContributor({ ...template, createdAt: new Date().toISOString() });
    return json(
      200,
      { authenticated: true, role: c.role, alias: c.alias, synthetic: true, storageMode: storage.mode },
      { "Set-Cookie": sessionCookieHeader(signSessionToken(c.id)) },
    );
  } catch (err) {
    return serverError(err);
  }
}
