import { unstable_rethrow } from "next/navigation";
import { StorageConfigError } from "@/lib/storage";
import { errorBody, type ServiceResult } from "./service";

const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

export const fromService = (r: ServiceResult) => json(r.status, r.body, r.headers);

/** Never leak internals; config problems are 503 so clients keep the item queued. */
export function serverError(err: unknown): Response {
  // Never swallow Next.js control-flow errors (prerender bail-out, notFound, redirects).
  unstable_rethrow(err);
  if (err instanceof StorageConfigError) {
    console.error(`[polltrace] storage config: ${err.message}`);
    return json(503, errorBody("STORAGE_NOT_CONFIGURED", "Evidence storage is not configured on this server."));
  }
  console.error("[polltrace] unexpected server error", err);
  return json(500, errorBody("INTERNAL_ERROR", "Unexpected server error. The submission can be retried safely."));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads at most `maxBytes` of the request body, aborting as soon as it is exceeded
 * (works without Content-Length / chunked bodies). Returns null if over the cap.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const MAX_JSON_BYTES = 16 * 1024;

/** Small JSON bodies only. Returns {ok:false,response} on oversize / invalid JSON. */
export async function readJsonCapped(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const bytes = await readBodyCapped(request, MAX_JSON_BYTES);
  if (bytes === null) return { ok: false, response: json(413, errorBody("BODY_TOO_LARGE", "JSON body too large.")) };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: json(400, errorBody("INVALID_JSON", "Expected a JSON body.")) };
  }
}

export const contentLengthOf = (request: Request): number | null => {
  const n = Number(request.headers.get("content-length") ?? "NaN");
  return Number.isFinite(n) && n >= 0 ? n : null;
};
