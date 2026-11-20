/**
 * Storage adapter selection (server-only).
 *  - SUPABASE when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are both set.
 *  - LOCAL_DEV otherwise, but NEVER in production unless POLLTRACE_ALLOW_LOCAL_STORE=1,
 *    so a deployed demo cannot silently pretend local files are remote storage.
 *  - A half-configured Supabase env fails closed instead of falling back.
 */
import path from "node:path";
import { createLocalStorage } from "./local";
import { createSupabaseStorage } from "./supabase";
import { importHistoricalNg2023 } from "@/lib/references/historical";
import { StorageConfigError, type EvidenceStorage, type StorageMode } from "./types";

export * from "./types";

type Env = Record<string, string | undefined>;

export function resolveStorageMode(env: Env = process.env): StorageMode {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) return "SUPABASE";
  if (key && !url) {
    throw new StorageConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is set without NEXT_PUBLIC_SUPABASE_URL; refusing to fall back to local storage.",
    );
  }
  if (env.NODE_ENV === "production" && env.POLLTRACE_ALLOW_LOCAL_STORE !== "1") {
    throw new StorageConfigError(
      "Supabase storage is not configured. LOCAL_DEV storage is disabled in production " +
        "(set POLLTRACE_ALLOW_LOCAL_STORE=1 only for an explicitly labelled local demo).",
    );
  }
  return "LOCAL_DEV";
}

export function localDataDir(env: Env = process.env): string {
  // LOCAL_DEV runtime data, not a build input: keep Next's file tracer out of it.
  return path.resolve(/*turbopackIgnore: true*/ env.POLLTRACE_LOCAL_DATA_DIR || path.join(process.cwd(), ".data"));
}

export function createStorage(env: Env = process.env): EvidenceStorage {
  const mode = resolveStorageMode(env);
  if (mode === "SUPABASE") {
    return createSupabaseStorage(env.NEXT_PUBLIC_SUPABASE_URL!.trim(), env.SUPABASE_SERVICE_ROLE_KEY!.trim());
  }
  return createLocalStorage(localDataDir(env));
}

// Survive Next dev HMR module reloads (keeps the in-process lock single).
const g = globalThis as unknown as { __polltraceStorage?: EvidenceStorage };

/**
 * LOCAL_DEV seeds the 2023 historical reference sample once per process (idempotent), so local dev
 * and E2E see the same references as SUPABASE (where supabase/admin/import-ng2023.mjs does it).
 * Off under vitest unless POLLTRACE_SEED_HISTORICAL=1; POLLTRACE_SEED_HISTORICAL=0 disables it.
 */
export function shouldSeedHistorical(env: Env = process.env): boolean {
  if (env.POLLTRACE_SEED_HISTORICAL === "1") return true;
  if (env.POLLTRACE_SEED_HISTORICAL === "0") return false;
  return env.NODE_ENV !== "test";
}

export function getStorage(): EvidenceStorage {
  if (!g.__polltraceStorage) {
    const storage = createStorage();
    if (storage.mode === "LOCAL_DEV") {
      console.warn(`[polltrace] Evidence storage mode LOCAL_DEV at ${localDataDir()} (not remote storage).`);
      if (shouldSeedHistorical()) {
        storage.ready = importHistoricalNg2023(storage).catch((err) => {
          console.error("[polltrace] historical sample seed failed", err);
        });
      }
    }
    g.__polltraceStorage = storage;
  }
  return g.__polltraceStorage;
}

/** Tests only: drop the cached adapter so env changes take effect. */
export function resetStorageForTests(): void {
  g.__polltraceStorage = undefined;
}
