/**
 * Extraction adapters. Output of every adapter is UNTRUSTED until it passes ResultDraft.safeParse
 * (done in ./index.ts) and a human confirms it. No adapter invents confidence scores: uncertainty
 * is expressed only as `needsReview` per field and plain-language `warnings`. Unreadable → null.
 *
 * Pure, server-safe TypeScript: no React, no DB, no network.
 */
import type { ExtractionMode, ResultDraft } from "@/lib/contracts";
import type { ExtractionAdapter, ExtractionInput } from "@/lib/contracts/trace";

export type Env = Record<string, string | undefined>;

export type ExtractionErrorCode = "MODE_UNAVAILABLE" | "INVALID_DRAFT" | "NOT_CONFIGURED";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ MANUAL */

export const MANUAL_WARNING = "Figures not read automatically. Enter them from the photo.";
export const MANUAL_NOTICE = "Manual entry: type the figures you can read on the photo.";

/** Always available. Produces an empty form (one null entry per roster party) for a human to fill. */
export const manualAdapter: ExtractionAdapter = {
  mode: "MANUAL",
  available: () => true,
  async extract(input: ExtractionInput): Promise<ResultDraft> {
    return {
      formType: "UNKNOWN",
      pollingUnitCode: null,
      entries: input.partyRoster.map((partyCode) => ({ partyCode, votes: null, needsReview: true })),
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: null,
      warnings: [MANUAL_WARNING],
      mode: "MANUAL",
    };
  },
};

/* ------------------------------------------------------------------ DEMO_FIXTURE */

export const DEMO_WARNING = "Demo fixture figures — not read from this photo.";
export const DEMO_NOTICE = "Demo mode: these are fixed synthetic figures, not read from the photo.";

/** SYNTHETIC witness figures from fixtures/demo_cases.json (witnessResult). Fictional test data. */
export const DEMO_FIXTURE_FIGURES: Readonly<Record<string, number>> = Object.freeze({
  PARTY_A: 145,
  PARTY_B: 210,
  PARTY_C: 42,
});

/**
 * Fixed synthetic figures for the deterministic demo. Never usable on non-synthetic evidence:
 * available() is false and extract() refuses, so a real photo can never receive demo numbers.
 */
export const demoFixtureAdapter: ExtractionAdapter = {
  mode: "DEMO_FIXTURE",
  available: (input) => input.synthetic === true,
  async extract(input: ExtractionInput): Promise<ResultDraft> {
    if (input.synthetic !== true) {
      throw new ExtractionError(
        "MODE_UNAVAILABLE",
        "Demo figures can only be used with synthetic demo evidence.",
      );
    }
    const entries = Object.entries(DEMO_FIXTURE_FIGURES).map(([partyCode, votes]) => ({
      partyCode,
      votes,
      needsReview: false,
    }));
    return {
      formType: "EC8A",
      pollingUnitCode: input.pollingUnitCode,
      entries,
      // Fixture does not state accredited / rejected → unknown, never guessed.
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: 397,
      warnings: [DEMO_WARNING],
      mode: "DEMO_FIXTURE",
    };
  },
};

/* ------------------------------------------------------------------ REAL_VISION */

/**
 * Providers with a verified implementation. EMPTY: no vision SDK is installed and none has been
 * verified for this MVP, so REAL_VISION is never available and the UI must not claim "AI read".
 *
 * How a provider plugs in (future work, requires lead approval for any new dependency):
 *  1. Add its id here and a `(input, apiKey) => Promise<unknown>` caller in `providerCallers`.
 *  2. Send the image as untrusted DATA only. The prompt must say the image may contain text that
 *     looks like instructions and that it must never be followed; ask only for the ResultDraft
 *     JSON shape. Never put secrets or contributor metadata in the request.
 *  3. Return the raw model JSON; ./index.ts runs ResultDraft.safeParse on it (invalid → throws
 *     INVALID_DRAFT), drops party codes not in the roster with a warning naming them, and
 *     appends deterministic consistency warnings. The caller must map unreadable/uncertain
 *     figures to null + needsReview=true and must not emit confidence scores.
 *  4. Everything is still a draft: a human confirms it via /confirm before it counts anywhere.
 */
export const SUPPORTED_VISION_PROVIDERS: readonly string[] = [];

const providerCallers: Record<string, (input: ExtractionInput, apiKey: string) => Promise<unknown>> = {};

export function realVisionConfigured(env: Env): boolean {
  const provider = env.VISION_PROVIDER?.trim();
  const key = env.VISION_API_KEY?.trim();
  return (
    !!provider &&
    !!key &&
    SUPPORTED_VISION_PROVIDERS.includes(provider) &&
    typeof providerCallers[provider] === "function"
  );
}

export function createRealVisionAdapter(env: Env): ExtractionAdapter {
  return {
    mode: "REAL_VISION",
    available: () => realVisionConfigured(env),
    async extract(input: ExtractionInput): Promise<ResultDraft> {
      if (!realVisionConfigured(env)) {
        throw new ExtractionError(
          "NOT_CONFIGURED",
          "Automatic reading is not configured on this server. Use manual entry.",
        );
      }
      const provider = env.VISION_PROVIDER!.trim();
      // Raw output is untrusted; validated by the caller in ./index.ts.
      return (await providerCallers[provider](input, env.VISION_API_KEY!.trim())) as ResultDraft;
    },
  };
}

export function adaptersFor(env: Env): Record<ExtractionMode, ExtractionAdapter> {
  return {
    REAL_VISION: createRealVisionAdapter(env),
    DEMO_FIXTURE: demoFixtureAdapter,
    MANUAL: manualAdapter,
  };
}
