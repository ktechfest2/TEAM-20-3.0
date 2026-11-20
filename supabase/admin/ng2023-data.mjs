// Shared loader for the REAL 2023 historical sample, read from the generated source of truth
// src/lib/seed/historical-ng2023.ts (+ the election row in src/lib/seed/registry.ts), so the SQL
// seed (0008) and the Supabase import runner can never drift from the app's registry.
// The description / figures / audit builders mirror src/lib/references/historical.ts exactly
// (enforced by src/lib/references/historical.test.ts).
import { readFileSync } from "node:fs";
import path from "node:path";

export const HISTORICAL_IMPORTER = {
  id: "0a157000-0000-4000-8000-000000002023",
  alias: "PollTrace historical data import",
  role: "REVIEWER",
  assurance: "SYSTEM_IMPORT",
  synthetic: false,
};

function must(m, what) {
  if (!m) throw new Error(`Could not parse ${what} from the historical sample source`);
  return m;
}

/** @param {string} repoRoot */
export function loadNg2023(repoRoot) {
  const src = readFileSync(path.join(repoRoot, "src/lib/seed/historical-ng2023.ts"), "utf8");
  const reg = readFileSync(path.join(repoRoot, "src/lib/seed/registry.ts"), "utf8");
  // Our own repository file; the object literal is plain data (string values only).
  const source = new Function(`return (${must(/export const NG2023_SOURCE = (\{[\s\S]*?\}) as const;/.exec(src), "NG2023_SOURCE")[1]})`)();
  const electionId = must(/export const NG2023_ELECTION_ID = "([^"]+)"/.exec(src), "NG2023_ELECTION_ID")[1];
  const roster = JSON.parse(must(/export const NG2023_PARTY_ROSTER = (\[[^\]]*\]) as const/.exec(src), "NG2023_PARTY_ROSTER")[1]);
  const decl = src.indexOf("export const NG2023_UNITS");
  const start = src.indexOf("= [", decl) + 2; // skip the `Ng2023Unit[]` type annotation
  const end = src.lastIndexOf("]");
  const units = JSON.parse(src.slice(start, end + 1));
  const e = must(/id: NG2023_ELECTION_ID,\s*name: "([^"]+)",\s*type: "([^"]+)",\s*date: "([^"]+)",\s*synthetic: (true|false)/.exec(reg), "registry election");
  const election = { id: electionId, name: e[1], type: e[2], date: e[3], synthetic: e[4] === "true" };
  return { source, electionId, roster, units, election };
}

const stated = (n) => (n === null || n === undefined ? "not stated" : String(n));

export function referenceDescription(u, source) {
  const fileName = source.file.split("/").at(-1);
  return (
    `Nigeria 2.0 independent crosscheck of 2023 presidential result sheets — ${fileName} ` +
    `(sha256 ${source.fileSha256.slice(0, 8)}…), retrieved ${source.retrievedAt}. ` +
    `Accredited voters ${stated(u.accreditedVoters)}, registered ${stated(u.registeredVoters)}. ` +
    `Sheet flags as published: stamped ${u.sheet.stamped}, corrected ${u.sheet.corrected}, invalid ${u.sheet.invalid}, ` +
    `unclear ${u.sheet.unclear}, unsigned ${u.sheet.unsigned}. ` +
    `Not INEC-certified; provenance not reviewed by PollTrace reviewers.`
  );
}

export const referenceFigures = (u, roster) => Object.fromEntries(roster.map((p) => [p, u.figures[p]]));

export const auditMetadata = (referenceId, u, data) => ({
  referenceId,
  electionId: data.electionId,
  pollingUnitId: u.id,
  version: 1,
  sourceType: "HISTORICAL_DATASET",
  source: data.source.id,
  file: data.source.file,
  sha256: data.source.fileSha256,
  sourceUrlRecorded: true,
  synthetic: false,
});
