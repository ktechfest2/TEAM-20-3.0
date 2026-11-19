"use client";
/**
 * Small typed fetch wrapper for the app's own JSON API. Every success body is parsed with the
 * frozen Zod contract; anything that does not parse is treated as an error, never as data.
 */
import type { z } from "zod";

export type ApiFailure =
  | { ok: false; kind: "network" }
  | { ok: false; kind: "http"; status: number; code: string | null; message: string | null; body: unknown }
  | { ok: false; kind: "invalid" };

export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

export async function apiJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<z.infer<S>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    return { ok: false, kind: "network" };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    return {
      ok: false,
      kind: "http",
      status: res.status,
      code: typeof err?.code === "string" ? err.code : null,
      message: typeof err?.message === "string" ? err.message : null,
      body,
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, kind: "invalid" };
  return { ok: true, status: res.status, data: parsed.data };
}

/** Human-readable list of validation issues from a 400 body (`issues` is strings or {path,message}). */
export function issueMessages(body: unknown): string[] {
  const issues = (body as { error?: { issues?: unknown } } | null)?.error?.issues;
  if (!Array.isArray(issues)) return [];
  return issues
    .map((i) => {
      if (typeof i === "string") return i;
      const o = i as { path?: unknown; message?: unknown };
      if (typeof o?.message !== "string") return null;
      const path = Array.isArray(o.path) && o.path.length ? `${o.path.join(".")}: ` : "";
      return `${path}${o.message}`;
    })
    .filter((m): m is string => Boolean(m));
}
