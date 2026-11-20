/**
 * Extraction adapters. Output of every adapter is UNTRUSTED until it passes ResultDraft.safeParse
 * (done in ./index.ts) and a human confirms it. No adapter invents confidence scores: uncertainty
 * is expressed only as `needsReview` per field and plain-language `warnings`. Unreadable → null.
 *
 * Server-only TypeScript: no React, no DB. Only the REAL_VISION adapter (./anthropic.ts) makes a
 * network call, to the configured vision provider.
 */
import type { ExtractionMode, ResultDraft } from "@/lib/contracts";
import type { ExtractionAdapter, ExtractionInput } from "@/lib/contracts/trace";
import { ANTHROPIC_PROVIDER, createAnthropicVisionAdapter, type VisionClient } from "./anthropic";
import { ExtractionError } from "./errors";

export { ExtractionError, type ExtractionErrorCode } from "./errors";

export type Env = Record<string, string | undefined>;

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

/** Providers with an implementation. Only Anthropic (Claude) is supported. */
export const SUPPORTED_VISION_PROVIDERS: readonly string[] = [ANTHROPIC_PROVIDER];

/**
 * REAL_VISION is available only when VISION_PROVIDER=anthropic AND ANTHROPIC_API_KEY is set
 * (server env). VISION_MODEL overrides the model (default claude-opus-5-5); VISION_EFFORT
 * overrides output effort (default medium).
 */
export function realVisionConfigured(env: Env): boolean {
  const provider = env.VISION_PROVIDER?.trim().toLowerCase();
  return provider === ANTHROPIC_PROVIDER && !!env.ANTHROPIC_API_KEY?.trim();
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function createRealVisionAdapter(env: Env, deps: { client?: VisionClient } = {}): ExtractionAdapter {
  if (!realVisionConfigured(env) && !deps.client) {
    return {
      mode: "REAL_VISION",
      available: () => false,
      async extract(): Promise<ResultDraft> {
        throw new ExtractionError(
          "NOT_CONFIGURED",
          "Automatic reading is not configured on this server. Use manual entry.",
        );
      },
    };
  }
  const effort = EFFORTS.find((e) => e === env.VISION_EFFORT?.trim());
  return createAnthropicVisionAdapter({
    apiKey: env.ANTHROPIC_API_KEY?.trim(),
    model: env.VISION_MODEL,
    effort,
    client: deps.client,
  });
}

export function adaptersFor(env: Env, deps: { client?: VisionClient } = {}): Record<ExtractionMode, ExtractionAdapter> {
  return {
    REAL_VISION: createRealVisionAdapter(env, deps),
    DEMO_FIXTURE: demoFixtureAdapter,
    MANUAL: manualAdapter,
  };
}
