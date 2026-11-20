/**
 * Import of the REAL 2023 historical sample (src/lib/seed/historical-ng2023.ts) as reference
 * records. Server-only. Idempotent: a unit that already has any reference is skipped.
 *  - sourceType HISTORICAL_DATASET, synthetic false, version 1, sourceVerified false (derived: no
 *    PollTrace reviewer has reviewed this provenance). Not INEC-certified.
 *  - sourceUrl is recorded as text only; nothing is ever fetched.
 * supabase/admin/import-ng2023.mjs performs the identical insert for SUPABASE (kept in sync by test).
 */
import { randomUUID } from "node:crypto";
import { NG2023_ELECTION_ID, NG2023_PARTY_ROSTER, NG2023_SOURCE, NG2023_UNITS, type Ng2023Unit } from "@/lib/seed/historical-ng2023";
import type { ContributorRecord, EvidenceStorage, ReferenceRecord } from "@/lib/storage";

/** System identity that "imported" the sample. Cannot sign in (no route mints a session for it). */
export const HISTORICAL_IMPORTER: Omit<ContributorRecord, "createdAt"> = {
  id: "0a157000-0000-4000-8000-000000002023",
  alias: "PollTrace historical data import",
  role: "REVIEWER",
  assurance: "SYSTEM_IMPORT",
  synthetic: false,
};

export const AUDIT_REFERENCE_IMPORTED = "REFERENCE_IMPORTED";

const stated = (n: number | null) => (n === null ? "not stated" : String(n));
const fileName = NG2023_SOURCE.file.split("/").at(-1)!;

/** Plain provenance text stored on the reference (shown to people as-is). */
export function ng2023ReferenceDescription(u: Ng2023Unit): string {
  // The UI states "not INEC-certified / provenance not reviewed" itself, so it is not repeated here.
  return (
    `Nigeria 2.0 independent crosscheck of 2023 presidential result sheets (${fileName}, ` +
    `sha256 ${NG2023_SOURCE.fileSha256.slice(0, 8)}…, retrieved ${NG2023_SOURCE.retrievedAt}). ` +
    `Accredited voters ${stated(u.accreditedVoters)}, registered ${stated(u.registeredVoters)}. ` +
    `Sheet flags as published: stamped ${u.sheet.stamped}, corrected ${u.sheet.corrected}, invalid ${u.sheet.invalid}, ` +
    `unclear ${u.sheet.unclear}, unsigned ${u.sheet.unsigned}.`
  );
}

export const ng2023Figures = (u: Ng2023Unit): Record<string, number> =>
  Object.fromEntries(NG2023_PARTY_ROSTER.map((p) => [p, u.figures[p]]));

export const ng2023AuditMetadata = (referenceId: string, u: Ng2023Unit) => ({
  referenceId,
  electionId: NG2023_ELECTION_ID,
  pollingUnitId: u.id,
  version: 1,
  sourceType: "HISTORICAL_DATASET",
  source: NG2023_SOURCE.id,
  file: NG2023_SOURCE.file,
  sha256: NG2023_SOURCE.fileSha256,
  sourceUrlRecorded: true,
  synthetic: false,
});

export async function importHistoricalNg2023(storage: EvidenceStorage, now: () => Date = () => new Date()) {
  const createdAt = now().toISOString();
  await storage.repo.ensureContributor({ ...HISTORICAL_IMPORTER, createdAt });
  let created = 0;
  let skipped = 0;
  for (const u of NG2023_UNITS) {
    const existing = await storage.repo.listReferences(NG2023_ELECTION_ID, u.id);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    const record: ReferenceRecord = {
      id: randomUUID(),
      electionId: NG2023_ELECTION_ID,
      pollingUnitId: u.id,
      sourceType: "HISTORICAL_DATASET",
      sourceDescription: ng2023ReferenceDescription(u),
      sourceUrl: NG2023_SOURCE.url,
      version: 1,
      figures: ng2023Figures(u),
      synthetic: false,
      createdBy: HISTORICAL_IMPORTER.id,
      createdAt,
    };
    if (!(await storage.repo.insertReference(record)).inserted) {
      skipped++; // a concurrent import took v1
      continue;
    }
    await storage.repo.appendAudit({
      id: randomUUID(),
      evidenceId: null,
      actorId: HISTORICAL_IMPORTER.id,
      eventType: AUDIT_REFERENCE_IMPORTED,
      metadata: ng2023AuditMetadata(record.id, u),
      createdAt,
    });
    created++;
  }
  return { created, skipped, total: NG2023_UNITS.length };
}
