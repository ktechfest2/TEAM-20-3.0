// ADMIN ONLY — removes every object from the private `evidence-originals` bucket (synthetic demo
// reset, user-approved 2026-11-20). Run AFTER reset_synthetic_demo.sql:
//   node --env-file=.env.local supabase/admin/reset-storage.mjs --yes
import { createClient } from "@supabase/supabase-js";

const BUCKET = "evidence-originals";
if (!process.argv.includes("--yes")) {
  console.error("Refusing without --yes (this deletes all stored originals).");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase URL / secret key missing from env.");
const db = createClient(url, key, { auth: { persistSession: false } });

async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const item of data) {
      const p = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(p))); // folder
      else out.push(p);
    }
    if (data.length < 1000) break;
  }
  return out;
}

const paths = await listAll("");
console.log(`objects found: ${paths.length}`);
for (let i = 0; i < paths.length; i += 100) {
  const { error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
  if (error) throw error;
}
console.log(`objects remaining: ${(await listAll("")).length}`);
