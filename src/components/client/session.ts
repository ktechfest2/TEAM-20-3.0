"use client";
/**
 * One shared view of GET /api/session for the shell (nav, reviewer strip) and pages.
 * The role is decided on the server; this store only mirrors what the server said.
 */
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";

export const SessionView = z.object({
  authenticated: z.boolean(),
  role: z.enum(["CONTRIBUTOR", "REVIEWER"]).optional(),
  alias: z.string().optional(),
  synthetic: z.boolean().optional(),
  storageMode: z.string().optional(),
  demoReviewersEnabled: z.boolean().optional(),
});
export type SessionView = z.infer<typeof SessionView>;

export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: SessionView }
  | { status: "error" };

let state: SessionState = { status: "loading" };
let inflight: Promise<void> | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: SessionState) {
  state = next;
  listeners.forEach((l) => l());
}

export function refreshSession(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      const parsed = SessionView.safeParse(await res.json().catch(() => null));
      if (!res.ok || !parsed.success) {
        // Keep a known session if a refresh fails (e.g. offline); only report error when unknown.
        if (state.status !== "ready") set({ status: "error" });
      } else set({ status: "ready", session: parsed.data });
    } catch {
      if (state.status !== "ready") set({ status: "error" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const SERVER: SessionState = { status: "loading" };

export function useSession(): SessionState {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
  useEffect(() => {
    if (!started) {
      started = true;
      void refreshSession();
    }
  }, []);
  return s;
}

export const isReviewer = (s: SessionState) => s.status === "ready" && s.session.role === "REVIEWER";

export async function signOut(): Promise<boolean> {
  try {
    const res = await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    await refreshSession();
    return res.ok;
  } catch {
    return false;
  }
}
