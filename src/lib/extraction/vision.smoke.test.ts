/**
 * OPT-IN live smoke test: calls the real Anthropic API on the SYNTHETIC demo sheet
 * (WITNESS_1_JPEG_BASE64: PARTY_A 145, PARTY_B 210, PARTY_C 42, unit DEMO.00.00.012).
 *
 *   POLLTRACE_VISION_SMOKE=1 npx vitest run src/lib/extraction/vision.smoke.test.ts
 *
 * Reads ANTHROPIC_API_KEY (and optional VISION_MODEL / VISION_EFFORT) from the environment or
 * .env.local. Skips with a clear message when not opted in or no key is present. Never prints
 * the key.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { WITNESS_1_JPEG_BASE64 } from "@/lib/demo/images";
import { PARTY_ROSTER } from "@/lib/seed/registry";
import { runExtraction } from "./index";

const OPTED_IN = process.env.POLLTRACE_VISION_SMOKE === "1";

function visionEnv(): Record<string, string | undefined> {
  const fromFile: Record<string, string | undefined> = {};
  if (existsSync(".env.local")) {
    const parsed = parseEnv(readFileSync(".env.local", "utf8")) as Record<string, string | undefined>;
    for (const k of ["ANTHROPIC_API_KEY", "VISION_MODEL", "VISION_EFFORT"]) fromFile[k] = parsed[k];
  }
  return {
    VISION_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || fromFile.ANTHROPIC_API_KEY,
    VISION_MODEL: process.env.VISION_MODEL || fromFile.VISION_MODEL,
    VISION_EFFORT: process.env.VISION_EFFORT || fromFile.VISION_EFFORT,
  };
}

const env = OPTED_IN ? visionEnv() : {};
const HAS_KEY = Boolean(env.ANTHROPIC_API_KEY?.trim());
const SKIP_REASON = !OPTED_IN
  ? "set POLLTRACE_VISION_SMOKE=1 to run the live vision smoke test"
  : "ANTHROPIC_API_KEY not found in env or .env.local";

describe("live vision smoke (synthetic demo sheet)", () => {
  if (!OPTED_IN || !HAS_KEY) {
    it.skip(`skipped: ${SKIP_REASON}`, () => {});
    return;
  }

  it("reads the synthetic sheet with REAL_VISION", { timeout: 120_000 }, async () => {
    const bytes = new Uint8Array(Buffer.from(WITNESS_1_JPEG_BASE64, "base64"));
    const r = await runExtraction(
      {
        evidenceId: "smoke-synthetic",
        bytes,
        mime: "image/jpeg",
        synthetic: true,
        pollingUnitCode: "DEMO.00.00.012",
        partyRoster: PARTY_ROSTER,
      },
      "REAL_VISION",
      env,
    );
    const raw = r.rawModelOutput as { modelOutput: { documentKind: string }; usage: unknown; analysisCopy: unknown };
    console.info(
      "[vision smoke]",
      JSON.stringify({
        provenance: r.provenance,
        documentKind: raw.modelOutput.documentKind,
        pollingUnitCode: r.draft.pollingUnitCode,
        entries: r.draft.entries,
        totals: { accredited: r.draft.accreditedVoters, rejected: r.draft.rejectedVotes, valid: r.draft.validVotes },
        uncertainFields: r.uncertainFields,
        warnings: r.draft.warnings,
        usage: raw.usage,
        analysisCopy: raw.analysisCopy,
      }),
    );
    expect(r.modeUsed).toBe("REAL_VISION");
    expect(["EC8A", "OTHER_RESULT_FORM"]).toContain(raw.modelOutput.documentKind);
    expect(r.draft.entries.map((e) => e.partyCode)).toEqual([...PARTY_ROSTER]);
    expect(r.draft.entries.filter((e) => e.votes !== null).length).toBeGreaterThan(0);
  });
});
