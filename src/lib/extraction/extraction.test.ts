/** Tests use SYNTHETIC demo data only (fixtures/demo_cases.json). */
import { describe, expect, it } from "vitest";
import type { ExtractionMode, ResultDraft } from "@/lib/contracts";
import type { ConfirmRequest, ExtractionAdapter, ExtractionInput } from "@/lib/contracts/trace";
import { PARTY_ROSTER } from "@/lib/seed/registry";
import {
  availableModes,
  consistencyWarnings,
  runExtraction,
  runExtractionWith,
  validateConfirm,
  UNREADABLE_WARNING,
} from "./index";
import { adaptersFor, createRealVisionAdapter, demoFixtureAdapter, DEMO_WARNING, MANUAL_WARNING } from "./adapters";

const PU = "DEMO.00.00.012";

function input(over: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    evidenceId: "ev-1",
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/jpeg",
    synthetic: true,
    pollingUnitCode: PU,
    partyRoster: PARTY_ROSTER,
    ...over,
  };
}

const NO_ENV = {};
const PROVIDER_ENV = { VISION_PROVIDER: "some-provider", VISION_API_KEY: "k" };

describe("availableModes matrix", () => {
  it.each([
    { synthetic: true, env: NO_ENV, expected: ["DEMO_FIXTURE", "MANUAL"] },
    { synthetic: false, env: NO_ENV, expected: ["MANUAL"] },
    // No provider is implemented, so even with env set REAL_VISION stays unavailable.
    { synthetic: true, env: PROVIDER_ENV, expected: ["DEMO_FIXTURE", "MANUAL"] },
    { synthetic: false, env: PROVIDER_ENV, expected: ["MANUAL"] },
    { synthetic: false, env: { VISION_PROVIDER: "x" }, expected: ["MANUAL"] },
    { synthetic: false, env: { VISION_API_KEY: "k" }, expected: ["MANUAL"] },
  ])("synthetic=$synthetic env=$env → $expected", ({ synthetic, env, expected }) => {
    expect(availableModes({ synthetic }, env)).toEqual(expected);
  });
});

describe("runExtraction mode selection", () => {
  it.each([
    { synthetic: true, expected: "DEMO_FIXTURE" },
    { synthetic: false, expected: "MANUAL" },
  ])("AUTO with synthetic=$synthetic uses $expected", async ({ synthetic, expected }) => {
    const r = await runExtraction(input({ synthetic }), "AUTO", NO_ENV);
    expect(r.modeUsed).toBe(expected);
    expect(r.draft.mode).toBe(expected);
  });

  it("AUTO prefers REAL_VISION when an adapter is available", async () => {
    const vision: ExtractionAdapter = {
      mode: "REAL_VISION",
      available: () => true,
      extract: async () => ({
        formType: "EC8A",
        pollingUnitCode: PU,
        entries: [
          { partyCode: "PARTY_A", votes: 145, needsReview: false },
          { partyCode: "PARTY_B", votes: 210, needsReview: false },
          { partyCode: "PARTY_C", votes: 42, needsReview: false },
        ],
        accreditedVoters: null,
        rejectedVotes: null,
        validVotes: 397,
        warnings: [],
        mode: "REAL_VISION",
      }),
    };
    const r = await runExtractionWith({ ...adaptersFor(NO_ENV), REAL_VISION: vision }, input(), "AUTO");
    expect(r.modeUsed).toBe("REAL_VISION");
    expect(r.availableModes).toEqual(["REAL_VISION", "DEMO_FIXTURE", "MANUAL"]);
  });

  it.each([
    { requested: "DEMO_FIXTURE" as const, synthetic: false },
    { requested: "REAL_VISION" as const, synthetic: true },
    { requested: "REAL_VISION" as const, synthetic: false },
  ])("explicit $requested (synthetic=$synthetic) → MODE_UNAVAILABLE", async ({ requested, synthetic }) => {
    await expect(runExtraction(input({ synthetic }), requested, PROVIDER_ENV)).rejects.toMatchObject({
      code: "MODE_UNAVAILABLE",
    });
  });

  it("demo adapter itself refuses non-synthetic evidence", async () => {
    expect(demoFixtureAdapter.available({ synthetic: false })).toBe(false);
    await expect(demoFixtureAdapter.extract(input({ synthetic: false }))).rejects.toMatchObject({
      code: "MODE_UNAVAILABLE",
    });
  });

  it("real vision adapter extract() throws NOT_CONFIGURED and never fakes output", async () => {
    const a = createRealVisionAdapter(PROVIDER_ENV);
    expect(a.available({ synthetic: true })).toBe(false);
    await expect(a.extract(input())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("MANUAL and DEMO_FIXTURE shapes", () => {
  it("MANUAL returns an empty, flagged form for every roster party", async () => {
    const r = await runExtraction(input({ synthetic: false }), "MANUAL", NO_ENV);
    expect(r.draft).toMatchObject({
      formType: "UNKNOWN",
      pollingUnitCode: null,
      accreditedVoters: null,
      rejectedVotes: null,
      validVotes: null,
      mode: "MANUAL",
    });
    expect(r.draft.entries).toEqual(
      PARTY_ROSTER.map((partyCode) => ({ partyCode, votes: null, needsReview: true })),
    );
    expect(r.draft.warnings[0]).toBe(MANUAL_WARNING);
    expect(r.notice).toBe("Manual entry: type the figures you can read on the photo.");
    expect(r.availableModes).toEqual(["MANUAL"]);
  });

  it("DEMO_FIXTURE returns synthetic 145/210/42 = 397 with no sum warning", async () => {
    const r = await runExtraction(input(), "DEMO_FIXTURE", NO_ENV);
    expect(r.draft.entries).toEqual([
      { partyCode: "PARTY_A", votes: 145, needsReview: false },
      { partyCode: "PARTY_B", votes: 210, needsReview: false },
      { partyCode: "PARTY_C", votes: 42, needsReview: false },
    ]);
    expect(r.draft).toMatchObject({
      formType: "EC8A",
      pollingUnitCode: PU,
      validVotes: 397,
      rejectedVotes: null,
      accreditedVoters: null,
    });
    expect(r.draft.warnings).toEqual([DEMO_WARNING]);
    expect(r.notice).toBe("Sample figures — not read from this photo. They are fixed example figures.");
  });
});

function stubAdapters(mode: ExtractionMode, output: unknown) {
  const stub: ExtractionAdapter = {
    mode,
    available: () => true,
    extract: async () => output as ResultDraft,
  };
  return { ...adaptersFor(NO_ENV), [mode]: stub } as Record<ExtractionMode, ExtractionAdapter>;
}

const goodDraft: ResultDraft = {
  formType: "EC8A",
  pollingUnitCode: PU,
  entries: [
    { partyCode: "PARTY_A", votes: 145, needsReview: false },
    { partyCode: "PARTY_B", votes: 210, needsReview: false },
    { partyCode: "PARTY_C", votes: 42, needsReview: false },
  ],
  accreditedVoters: null,
  rejectedVotes: null,
  validVotes: 397,
  warnings: [],
  mode: "REAL_VISION",
};

describe("adapter output validation and roster filtering", () => {
  it("drops unknown party codes with a warning naming them", async () => {
    const out = {
      ...goodDraft,
      entries: [
        ...goodDraft.entries,
        { partyCode: "PARTY_Z", votes: 9, needsReview: false },
        { partyCode: "IGNORE_PREVIOUS", votes: 1, needsReview: false },
      ],
    };
    const r = await runExtractionWith(stubAdapters("REAL_VISION", out), input(), "REAL_VISION");
    expect(r.draft.entries.map((e) => e.partyCode)).toEqual([...PARTY_ROSTER]);
    expect(r.draft.warnings.some((w) => w.includes("PARTY_Z") && w.includes("IGNORE_PREVIOUS"))).toBe(true);
  });

  it("adds missing roster parties as unreadable and flags them", async () => {
    const out = { ...goodDraft, entries: goodDraft.entries.slice(0, 2) };
    const r = await runExtractionWith(stubAdapters("REAL_VISION", out), input(), "REAL_VISION");
    expect(r.draft.entries[2]).toEqual({ partyCode: "PARTY_C", votes: null, needsReview: true });
    expect(r.draft.warnings).toContain(UNREADABLE_WARNING);
  });

  it.each([
    { name: "negative votes", out: { ...goodDraft, entries: [{ partyCode: "PARTY_A", votes: -1, needsReview: false }] } },
    { name: "fractional votes", out: { ...goodDraft, validVotes: 1.5 } },
    { name: "string votes", out: { ...goodDraft, entries: [{ partyCode: "PARTY_A", votes: "145", needsReview: false }] } },
    { name: "unknown form type", out: { ...goodDraft, formType: "EC99" } },
    { name: "confidence instead of needsReview", out: { ...goodDraft, entries: [{ partyCode: "PARTY_A", votes: 1, confidence: 0.9 }] } },
    { name: "not an object", out: "PARTY_A: 145" },
    { name: "wrong mode label", out: { ...goodDraft, mode: "DEMO_FIXTURE" } },
  ])("rejects invalid adapter output: $name", async ({ out }) => {
    await expect(
      runExtractionWith(stubAdapters("REAL_VISION", out), input(), "REAL_VISION"),
    ).rejects.toMatchObject({ code: "INVALID_DRAFT" });
  });
});

const entries = (a: number | null, b: number | null, c: number | null) => [
  { partyCode: "PARTY_A", votes: a, needsReview: false },
  { partyCode: "PARTY_B", votes: b, needsReview: false },
  { partyCode: "PARTY_C", votes: c, needsReview: false },
];

describe("consistencyWarnings", () => {
  it.each([
    {
      name: "synthetic consistent case 145+210+42=397",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: 3, accreditedVoters: 400, pollingUnitCode: PU },
      expected: [],
    },
    {
      name: "sum mismatch",
      d: { entries: entries(145, 270, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: null },
      expected: ["Party votes add up to 457 but valid votes says 397."],
    },
    {
      name: "sum skipped when a figure is unreadable",
      d: { entries: entries(145, null, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: null },
      expected: [UNREADABLE_WARNING],
    },
    {
      name: "valid + rejected above accredited",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: 10, accreditedVoters: 400, pollingUnitCode: null },
      expected: ["Valid and rejected votes add up to 407 but accredited voters says 400."],
    },
    {
      name: "valid alone above accredited when rejected unknown",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: 300, pollingUnitCode: null },
      expected: ["Valid votes (397) is more than accredited voters (300)."],
    },
    {
      name: "accredited unknown → no turnout comparison",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: 999, accreditedVoters: null, pollingUnitCode: null },
      expected: [],
    },
    {
      name: "code normalisation: lower case matches",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: "demo.00.00.012" },
      expected: [],
    },
    {
      name: "code normalisation: spaces/dashes match",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: " DEMO-00 00.012 " },
      expected: [],
    },
    {
      name: "code mismatch",
      d: { entries: entries(145, 210, 42), validVotes: 397, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: "DEMO.00.00.007" },
      expected: ["Code on the sheet (DEMO.00.00.007) does not match the chosen polling unit (DEMO.00.00.012)."],
    },
    {
      name: "empty sheet code is ignored",
      d: { entries: entries(145, 210, 42), validVotes: null, rejectedVotes: null, accreditedVoters: null, pollingUnitCode: "  " },
      expected: [],
    },
  ])("$name", ({ d, expected }) => {
    const w = consistencyWarnings(d, PU);
    expect(w).toEqual(expected);
    for (const msg of w) expect(msg).not.toMatch(/fraud|rig|fake|manipulat|tamper/i);
  });
});

function confirm(over: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    basedOnRevision: 1,
    formType: "EC8A",
    pollingUnitCodeOnSheet: PU,
    entries: entries(145, 210, 42),
    accreditedVoters: null,
    rejectedVotes: null,
    validVotes: 397,
    ...over,
  };
}

describe("validateConfirm", () => {
  it("accepts complete synthetic figures with no warnings", () => {
    expect(validateConfirm(confirm(), PARTY_ROSTER)).toEqual({ ok: true, entries: entries(145, 210, 42), warnings: [] });
  });

  it.each([
    {
      name: "missing party",
      entries: entries(145, 210, 42).slice(0, 2),
      issue: "Enter a figure or mark unreadable for PARTY_C",
    },
    {
      name: "duplicate party",
      entries: [...entries(145, 210, 42), { partyCode: "PARTY_A", votes: 1, needsReview: false }],
      issue: "PARTY_A is entered more than once.",
    },
    {
      name: "unknown party",
      entries: [...entries(145, 210, 42), { partyCode: "PARTY_Z", votes: 1, needsReview: false }],
      issue: "PARTY_Z is not on this election's party list.",
    },
  ])("rejects $name", ({ entries: es, issue }) => {
    const r = validateConfirm(confirm({ entries: es }), PARTY_ROSTER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain(issue);
  });

  it("allows null votes but forces needsReview=true", () => {
    const r = validateConfirm(confirm({ entries: entries(145, null, 42) }), PARTY_ROSTER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries[1]).toEqual({ partyCode: "PARTY_B", votes: null, needsReview: true });
      expect(r.warnings).toContain(UNREADABLE_WARNING);
    }
  });

  it("returns entries in roster order and reports sum warnings", () => {
    const r = validateConfirm(
      confirm({ entries: [...entries(145, 270, 42)].reverse(), validVotes: 397 }),
      PARTY_ROSTER,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries.map((e) => e.partyCode)).toEqual([...PARTY_ROSTER]);
      expect(r.warnings).toEqual(["Party votes add up to 457 but valid votes says 397."]);
    }
  });
});
