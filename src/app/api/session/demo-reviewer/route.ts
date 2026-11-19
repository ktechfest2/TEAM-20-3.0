import { z } from "zod";
import { sessionCookieHeader, signSessionToken } from "@/lib/auth/session";
import { DEMO_REVIEWERS, demoReviewerLoginDenied } from "@/lib/auth/demo-reviewers";
import { json, serverError } from "@/lib/evidence/http";
import { errorBody } from "@/lib/evidence/service";
import { getStorage } from "@/lib/storage";

const Body = z.object({ reviewer: z.enum(["A", "B"]), passcode: z.string().max(200).optional() });

/**
 * Sign in as a SYNTHETIC demo reviewer. Disabled (403) unless POLLTRACE_DEMO_REVIEWERS=1;
 * in production also requires POLLTRACE_DEMO_REVIEWER_PASSCODE. Replaces the current
 * session cookie (the browser stops acting as its contributor identity).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json(400, errorBody("INVALID_JSON", "Expected a JSON body."));
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json(400, errorBody("INVALID_REQUEST", "Expected { reviewer: 'A' | 'B', passcode? }."));

    const denied = demoReviewerLoginDenied(parsed.data.passcode);
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
