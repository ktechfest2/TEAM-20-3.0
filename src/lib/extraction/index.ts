/**
 * Extraction service boundary used by /api/evidence/:id/extract and /confirm.
 * Reads drafts; never decides truth. Consistency warnings are deterministic, neutral and never
 * allege wrongdoing. A draft only counts after a human confirms it.
 */
import { ResultDraft, type ExtractionMode, type ResultField } from "@/lib/contracts";
import type {
  ConfirmRequest,
  ExtractionAdapter,
  ExtractionInput,
  ExtractRequestMode,
} from "@/lib/contracts/trace";
import {
  adaptersFor,
  DEMO_NOTICE,
  ExtractionError,
  MANUAL_NOTICE,
  type Env,
} from "./adapters";

export { ExtractionError, type ExtractionErrorCode } from "./adapters";

const MODE_ORDER: readonly ExtractionMode[] = ["REAL_VISION", "DEMO_FIXTURE", "MANUAL"];

const NOTICES: Record<ExtractionMode, string> = {
  REAL_VISION:
    "Automatic reading: these figures were read by software and may be wrong. Check every figure against the photo.",
  DEMO_FIXTURE: DEMO_NOTICE,
  MANUAL: MANUAL_NOTICE,
};

export const UNREADABLE_WARNING = "Some figures could not be read.";

function defaultEnv(): Env {
  return typeof process !== "undefined" ? process.env : {};
}

function modesFrom(
  adapters: Record<ExtractionMode, ExtractionAdapter>,
  input: Pick<ExtractionInput, "synthetic">,
): ExtractionMode[] {
  return MODE_ORDER.filter((m) => adapters[m].available(input));
}

export function availableModes(
  input: Pick<ExtractionInput, "synthetic">,
  env: Env = defaultEnv(),
): ExtractionMode[] {
  return modesFrom(adaptersFor(env), input);
}

/** Lower-case, strip everything but letters/digits ("demo.00.00.012" ≡ "DEMO 00-00-012"). */
export function normalisePollingUnitCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function consistencyWarnings(
  d: Pick<ResultDraft, "entries" | "accreditedVoters" | "rejectedVotes" | "validVotes" | "pollingUnitCode">,
  registryPollingUnitCode: string,
): string[] {
  const warnings: string[] = [];
  const votes = d.entries.map((e) => e.votes);
  const allKnown = votes.length > 0 && votes.every((v): v is number => v !== null);

  if (allKnown && d.validVotes !== null) {
    const sum = votes.reduce((a, b) => a + b, 0);
    if (sum !== d.validVotes) {
      warnings.push(`Party votes add up to ${sum} but valid votes says ${d.validVotes}.`);
    }
  }

  if (d.accreditedVoters !== null && d.validVotes !== null) {
    if (d.rejectedVotes !== null) {
      const cast = d.validVotes + d.rejectedVotes;
      if (cast > d.accreditedVoters) {
        warnings.push(
          `Valid and rejected votes add up to ${cast} but accredited voters says ${d.accreditedVoters}.`,
        );
      }
    } else if (d.validVotes > d.accreditedVoters) {
      warnings.push(
        `Valid votes (${d.validVotes}) is more than accredited voters (${d.accreditedVoters}).`,
      );
    }
  }

  const onSheet = d.pollingUnitCode?.trim();
  if (onSheet && normalisePollingUnitCode(onSheet) !== normalisePollingUnitCode(registryPollingUnitCode)) {
    warnings.push(
      `Code on the sheet (${onSheet}) does not match the chosen polling unit (${registryPollingUnitCode}).`,
    );
  }

  if (votes.some((v) => v === null)) warnings.push(UNREADABLE_WARNING);
  return warnings;
}

/**
 * Keep only roster parties (first occurrence), add missing roster parties as null/needsReview,
 * and return warnings for anything dropped.
 */
function filterToRoster(
  entries: ResultField[],
  roster: readonly string[],
): { entries: ResultField[]; warnings: string[] } {
  const allowed = new Set(roster);
  const seen = new Map<string, ResultField>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  for (const e of entries) {
    if (!allowed.has(e.partyCode)) {
      if (!unknown.includes(e.partyCode)) unknown.push(e.partyCode);
    } else if (seen.has(e.partyCode)) {
      if (!duplicate.includes(e.partyCode)) duplicate.push(e.partyCode);
    } else {
      seen.set(e.partyCode, { ...e, needsReview: e.needsReview || e.votes === null });
    }
  }
  const out = roster.map(
    (code) => seen.get(code) ?? { partyCode: code, votes: null, needsReview: true },
  );
  const warnings: string[] = [];
  if (unknown.length) {
    warnings.push(`Ignored party codes that are not on this election's list: ${unknown.join(", ")}.`);
  }
  if (duplicate.length) {
    warnings.push(`Party listed more than once; kept the first figure: ${duplicate.join(", ")}.`);
  }
  return { entries: out, warnings };
}

/** Test seam: same as runExtraction with injectable adapters. */
export async function runExtractionWith(
  adapters: Record<ExtractionMode, ExtractionAdapter>,
  input: ExtractionInput,
  requested: ExtractRequestMode,
): Promise<{ draft: ResultDraft; modeUsed: ExtractionMode; availableModes: ExtractionMode[]; notice: string }> {
  const modes = modesFrom(adapters, input);
  let mode: ExtractionMode;
  if (requested === "AUTO") {
    // modes always contains MANUAL; order encodes REAL_VISION > DEMO_FIXTURE > MANUAL.
    mode = modes[0] ?? "MANUAL";
  } else {
    if (!modes.includes(requested)) {
      throw new ExtractionError(
        "MODE_UNAVAILABLE",
        requested === "DEMO_FIXTURE"
          ? "Demo figures can only be used with synthetic demo evidence."
          : requested === "REAL_VISION"
            ? "Automatic reading is not configured on this server. Use manual entry."
            : `Extraction mode ${requested} is not available.`,
      );
    }
    mode = requested;
  }

  const raw: unknown = await adapters[mode].extract(input);
  const parsed = ResultDraft.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractionError(
      "INVALID_DRAFT",
      `Extraction output did not match the expected shape: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.mode !== mode) {
    throw new ExtractionError("INVALID_DRAFT", `Adapter for ${mode} labelled its output ${parsed.data.mode}.`);
  }

  const filtered = filterToRoster(parsed.data.entries, input.partyRoster);
  const base: ResultDraft = { ...parsed.data, entries: filtered.entries };
  const warnings = [...parsed.data.warnings, ...filtered.warnings];
  for (const w of consistencyWarnings(base, input.pollingUnitCode)) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  return {
    draft: { ...base, warnings },
    modeUsed: mode,
    availableModes: modes,
    notice: NOTICES[mode],
  };
}

export async function runExtraction(
  input: ExtractionInput,
  requested: ExtractRequestMode,
  env: Env = defaultEnv(),
): Promise<{ draft: ResultDraft; modeUsed: ExtractionMode; availableModes: ExtractionMode[]; notice: string }> {
  return runExtractionWith(adaptersFor(env), input, requested);
}

export function validateConfirm(
  req: ConfirmRequest,
  roster: readonly string[],
): { ok: true; entries: ResultField[]; warnings: string[] } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const allowed = new Set(roster);
  const counts = new Map<string, number>();
  for (const e of req.entries) counts.set(e.partyCode, (counts.get(e.partyCode) ?? 0) + 1);

  for (const [code, n] of counts) {
    if (!allowed.has(code)) issues.push(`${code} is not on this election's party list.`);
    else if (n > 1) issues.push(`${code} is entered more than once.`);
  }
  for (const code of roster) {
    if (!counts.has(code)) issues.push(`Enter a figure or mark unreadable for ${code}`);
  }
  if (issues.length) return { ok: false, issues };

  // Roster order; null means "I can't read this" and always stays flagged for review.
  const byCode = new Map(req.entries.map((e) => [e.partyCode, e]));
  const entries: ResultField[] = roster.map((code) => {
    const e = byCode.get(code)!;
    return { partyCode: code, votes: e.votes, needsReview: e.votes === null ? true : e.needsReview };
  });
  // Registry code is not known here; compare the sheet code against itself so only figure checks apply.
  const warnings = consistencyWarnings(
    {
      entries,
      accreditedVoters: req.accreditedVoters,
      rejectedVotes: req.rejectedVotes,
      validVotes: req.validVotes,
      pollingUnitCode: null,
    },
    "",
  );
  return { ok: true, entries, warnings };
}
