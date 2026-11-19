"use client";

import { useCallback, useEffect, useState } from "react";
import { EvidenceTrace } from "@/lib/contracts/trace";
import { apiJson } from "@/components/client/api";

export type TraceState =
  | { status: "loading" }
  | { status: "ready"; trace: EvidenceTrace; cachedAt: string | null }
  | { status: "failed"; kind: "notFound" | "unauthenticated" | "offline" | "error" };

const KEY = (id: string) => `polltrace:trace:${id}`;

/**
 * Last trace this browser saw, so the page can still be read offline. Stored per viewer browser
 * only; it is a display copy, never a source of truth and never sent anywhere.
 */
function readCache(id: string): { trace: EvidenceTrace; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const o = JSON.parse(raw) as { trace?: unknown; savedAt?: unknown };
    const parsed = EvidenceTrace.safeParse(o.trace);
    return parsed.success && typeof o.savedAt === "string" ? { trace: parsed.data, savedAt: o.savedAt } : null;
  } catch {
    return null;
  }
}
function writeCache(id: string, trace: EvidenceTrace) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify({ trace, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full or blocked: the page still works online */
  }
}
function dropCache(id: string) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}

export function useTrace(id: string) {
  const [state, setState] = useState<TraceState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const r = await apiJson(`/api/evidence/${encodeURIComponent(id)}/trace`, EvidenceTrace, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (r.ok) {
        writeCache(id, r.data);
        setState({ status: "ready", trace: r.data, cachedAt: null });
        return;
      }
      if (r.kind === "http" && r.status === 404) {
        dropCache(id);
        return setState({ status: "failed", kind: "notFound" });
      }
      if (r.kind === "http" && r.status === 401) return setState({ status: "failed", kind: "unauthenticated" });
      if (r.kind === "network") {
        const cached = readCache(id);
        if (cached) return setState({ status: "ready", trace: cached.trace, cachedAt: cached.savedAt });
        return setState({ status: "failed", kind: "offline" });
      }
      setState({ status: "failed", kind: "error" });
    })().catch(() => {
      /* aborted */
    });
    return () => ctrl.abort();
  }, [id, nonce]);

  /** Re-fetch. Keeps showing the current trace while loading (no flash of skeleton). */
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);
  return { state, reload, retry };
}

export const latestRevisionOf = (t: EvidenceTrace) =>
  t.revisions.reduce<EvidenceTrace["revisions"][number] | null>((a, r) => (!a || r.revisionNumber > a.revisionNumber ? r : a), null);
