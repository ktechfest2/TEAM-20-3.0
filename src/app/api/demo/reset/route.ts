import { demoAdminGate } from "@/lib/demo/http";
import { resetDemo } from "@/lib/demo/scenario";
import { json, serverError } from "@/lib/evidence/http";
import { getStorage } from "@/lib/storage";

/** Presenter-only. Deletes ONLY the synthetic demo actors' rows on the demo unit. */
export async function POST(request: Request): Promise<Response> {
  try {
    const gate = await demoAdminGate(request);
    if (!gate.ok) return gate.response;
    return json(200, await resetDemo({ storage: getStorage() }));
  } catch (err) {
    return serverError(err);
  }
}
