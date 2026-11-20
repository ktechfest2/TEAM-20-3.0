import { demoAdminGate } from "@/lib/demo/http";
import { runDemoStage } from "@/lib/demo/scenario";
import { fromService, json, serverError } from "@/lib/evidence/http";
import { getStorage } from "@/lib/storage";

/** Presenter-only (server passcode). Runs one demo stage through the real services. Idempotent. */
export async function POST(request: Request, ctx: { params: Promise<{ stage: string }> }): Promise<Response> {
  try {
    const gate = await demoAdminGate(request);
    if (!gate.ok) return gate.response;
    const { stage } = await ctx.params;
    const r = await runDemoStage(stage, { storage: getStorage() });
    return r.ok ? json(200, r.state) : fromService(r.result);
  } catch (err) {
    return serverError(err);
  }
}
