import { MAX_ORIGINAL_BYTES } from "@/lib/contracts";
import { getPrincipal } from "@/lib/auth/session";
import { fromService, json, serverError } from "@/lib/evidence/http";
import { uploadLimiter } from "@/lib/evidence/rate-limit";
import { errorBody, submitEvidence } from "@/lib/evidence/service";
import { getStorage } from "@/lib/storage";

/** Multipart envelope overhead allowance on top of the image cap. */
const MULTIPART_SLACK = 64 * 1024;
const FIELDS = [
  "electionId",
  "pollingUnitId",
  "clientSubmissionId",
  "originalSha256",
  "capturedAtClaimed",
  "sourceType",
] as const;

export async function POST(request: Request): Promise<Response> {
  try {
    const storage = getStorage();
    const principal = await getPrincipal(request, storage);
    const deps = { storage, rateLimiter: uploadLimiter() };
    if (!principal) return fromService(await submitEvidence({ principal, fields: {}, file: null }, deps));

    // Reject obviously oversized bodies before buffering them.
    const declared = Number(request.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > MAX_ORIGINAL_BYTES + MULTIPART_SLACK) {
      return json(413, errorBody("FILE_TOO_LARGE", `Original exceeds ${MAX_ORIGINAL_BYTES} bytes.`, { maxBytes: MAX_ORIGINAL_BYTES }));
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(400, errorBody("INVALID_MULTIPART", "Expected multipart/form-data."));
    }

    const fields: Record<string, string | undefined> = {};
    for (const name of FIELDS) {
      const v = form.get(name);
      fields[name] = typeof v === "string" ? v : undefined;
    }

    const part = form.get("file");
    let file: Uint8Array | null = null;
    if (part instanceof Blob) {
      if (part.size > MAX_ORIGINAL_BYTES) {
        return json(413, errorBody("FILE_TOO_LARGE", `Original exceeds ${MAX_ORIGINAL_BYTES} bytes.`, { maxBytes: MAX_ORIGINAL_BYTES }));
      }
      file = new Uint8Array(await part.arrayBuffer());
    }

    return fromService(await submitEvidence({ principal, fields, file }, deps));
  } catch (err) {
    return serverError(err);
  }
}
