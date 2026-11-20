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
import { adaptersFor, DEMO_NOTICE, MANUAL_NOTICE, type Env } from "./adapters";
import type { DetailedExtractionAdapter, VisionProvenance } from "./anthropic";
import { ExtractionError } from "./errors";

export { ExtractionError, type ExtractionErrorCode } from "./errors";
export { makeAnalysisCopy, type AnalysisCopy, type AnalysisCopyMeta } from "./analysis-copy";

export const REAL_VISION_NOTICE =
  "Read by an AI model. Check every figure against the photo before confirming.";

export interface ExtractionRun {
  draft: ResultDraft;
  modeUsed: ExtractionMode;
  availableModes: ExtractionMode[];
  notice: string;
  /** Fields needing a human look (REAL_VISION only; [] for manual/demo). Never a score. */
  uncertainFields: string[];
  /** Who produced the draft (REAL_VISION only). */
  provenance: VisionProvenance | null;
  /** Validated model JSON + analysis-copy metadata (REAL_VISION only). Never keys or headers. */
  rawModelOutput: unknown | null;
}

const MODE_ORDER: readonly ExtractionMode[] = ["REAL_VISION", "DEMO_FIXTURE", "MANUAL"];

const NOTICES: Record<ExtractionMode, string> = {
  REAL_VISION: REAL_VISION_NOTICE,
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

function isDetailed(a: ExtractionAdapter): a is DetailedExtractionAdapter {
  return typeof (a as Partial<DetailedExtractionAdapter>).extractDetailed === "function";
}

/** Test seam: same as runExtraction with injectable adapters. */
export async function runExtractionWith(
  adapters: Record<ExtractionMode, ExtractionAdapter>,
  input: ExtractionInput,
  requested: ExtractRequestMode,
): Promise<ExtractionRun> {
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
          ? "Sample figures can only be used with sample evidence."
          : requested === "REAL_VISION"
            ? "Automatic reading is not configured on this server. Use manual entry."
            : `Extraction mode ${requested} is not available.`,
      );
    }
    mode = requested;
  }

  const adapter = adapters[mode];
  let raw: unknown;
  let uncertainFields: string[] = [];
  let provenance: VisionProvenance | null = null;
  let rawModelOutput: unknown | null = null;
  if (isDetailed(adapter)) {
    const detailed = await adapter.extractDetailed(input);
    raw = detailed.draft;
    uncertainFields = detailed.uncertainFields;
    provenance = detailed.provenance;
    rawModelOutput = detailed.rawModelOutput;
  } else {
    raw = await adapter.extract(input);
  }
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
  if (mode === "REAL_VISION") {
    // Roster parties the model did not read (or read unclearly) also need a human look.
    const set = new Set(uncertainFields);
    for (const e of base.entries) if (e.needsReview) set.add(e.partyCode);
    uncertainFields = [...set];
  }
  return {
    draft: { ...base, warnings },
    modeUsed: mode,
    availableModes: modes,
    notice: NOTICES[mode],
    uncertainFields,
    provenance,
    rawModelOutput,
  };
}

export async function runExtraction(
  input: ExtractionInput,
  requested: ExtractRequestMode,
  env: Env = defaultEnv(),
): Promise<ExtractionRun> {
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
