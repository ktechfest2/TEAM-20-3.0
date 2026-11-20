import { getDemoState } from "@/lib/demo/scenario";
import { json, serverError } from "@/lib/evidence/http";
import { getStorage } from "@/lib/storage";

/** PUBLIC: guided demo state (no secrets). */
export async function GET(): Promise<Response> {
  try {
    return json(200, await getDemoState({ storage: getStorage() }));
  } catch (err) {
    return serverError(err);
  }
}
