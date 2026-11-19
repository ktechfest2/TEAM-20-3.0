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
  if (err instanceof StorageConfigError) {
    console.error(`[polltrace] storage config: ${err.message}`);
    return json(503, errorBody("STORAGE_NOT_CONFIGURED", "Evidence storage is not configured on this server."));
  }
  console.error("[polltrace] unexpected server error", err);
  return json(500, errorBody("INTERNAL_ERROR", "Unexpected server error. The submission can be retried safely."));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
