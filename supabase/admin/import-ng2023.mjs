// Admin runner: imports the REAL 2023 historical sample as reference records into Supabase,
// exactly like src/lib/references/historical.ts does for LOCAL_DEV. Idempotent (units that already
// have any reference are skipped), audited (REFERENCE_IMPORTED per reference). Never prints secrets.
//
// Prerequisite: migration 0008_seed_ng2023_sample.sql applied (election + polling units).
// Usage (repo root): node supabase/admin/import-ng2023.mjs [--dry-run]
//   env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read from the environment or .env.local)
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditMetadata, HISTORICAL_IMPORTER, loadNg2023, referenceDescription, referenceFigures } from "./ng2023-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Rows the import would insert for one unit (pure; also used by the sync test). */
export function buildRows(u, data, referenceId, createdAt) {
  return {
    reference: {
      id: referenceId,
      election_id: data.electionId,
      polling_unit_id: u.id,
      source_type: "HISTORICAL_DATASET",
      source_description: referenceDescription(u, data.source),
      source_url: data.source.url, // recorded as text only, never fetched
      version: 1,
      figures: referenceFigures(u, data.roster),
      source_verified: false, // derived from reference_reviews; column unused
      synthetic: false,
      created_by: HISTORICAL_IMPORTER.id,
      created_at: createdAt,
    },
    audit: {
      id: randomUUID(),
      evidence_id: null,
      actor_id: HISTORICAL_IMPORTER.id,
      event_type: "REFERENCE_IMPORTED",
      metadata: auditMetadata(referenceId, u, data),
      created_at: createdAt,
    },
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envFile = path.join(root, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (values are never printed).");
    process.exit(1);
  }
  const { createClient } = createRequire(path.join(root, "package.json"))("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const data = loadNg2023(root);

  const election = await db.from("elections").select("id").eq("id", data.electionId).maybeSingle();
  if (election.error) throw new Error(`elections read failed: ${election.error.message}`);
  if (!election.data) {
    console.error(`Election ${data.electionId} not found: apply migration 0008_seed_ng2023_sample.sql first.`);
    process.exit(1);
  }

  const existing = await db.from("reference_results").select("polling_unit_id").eq("election_id", data.electionId);
  if (existing.error) throw new Error(`reference read failed: ${existing.error.message}`);
  const have = new Set((existing.data ?? []).map((r) => r.polling_unit_id));
  const todo = data.units.filter((u) => !have.has(u.id));
  console.log(`historical sample: ${data.units.length} units, ${have.size} already have a reference, ${todo.length} to import${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return;

  const c = await db.from("contributors").insert({ ...HISTORICAL_IMPORTER, created_at: new Date().toISOString() });
  if (c.error && c.error.code !== "23505") throw new Error(`importer contributor insert failed: ${c.error.message}`);

  let created = 0;
  let skipped = 0;
  for (const u of todo) {
    const { reference, audit } = buildRows(u, data, randomUUID(), new Date().toISOString());
    const r = await db.from("reference_results").insert(reference);
    if (r.error?.code === "23505") {
      skipped++; // a concurrent run took v1
      continue;
    }
    if (r.error) throw new Error(`reference insert failed for ${u.id}: ${r.error.message}`);
    const a = await db.from("audit_events").insert(audit);
    if (a.error) throw new Error(`audit insert failed for ${u.id}: ${a.error.message}`);
    created++;
  }
  console.log(`done: created ${created}, skipped ${skipped + have.size}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
