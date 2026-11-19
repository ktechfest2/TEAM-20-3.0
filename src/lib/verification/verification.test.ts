/** All data here is SYNTHETIC (fixtures/demo_cases.json). Not official election results. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Independence, ReviewDecision, VerificationStatus } from "@/lib/contracts";
import {
  UnitVerification,
  type VerificationEvidenceInput,
  type VerificationInput,
  type VerificationReferenceInput,
} from "@/lib/contracts/verification";
import { computeVerification, EXCLUDED } from "./index";

interface Scenario {
  id: string;
  images: string[];
  independence: Independence;
  votesB?: number[];
  referenceSourceVerified?: boolean;
  reference?: null;
  expectedStatus: VerificationStatus;
}
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../fixtures/demo_cases.json", import.meta.url)), "utf8"),
) as {
  partyRoster: string[];
  witnessResult: Record<string, number>;
  referenceResult: Record<string, number>;
  expectedReferenceMinusWitness: Record<string, number>;
  scenarios: Scenario[];
};

const ROSTER = fixture.partyRoster;
const WITNESS = fixture.witnessResult; // 145 / 210 / 42
const shaOf = (label: string) => {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8);
};

let seq = 0;
function ev(over: Partial<VerificationEvidenceInput> & { figures?: Record<string, number | null> } = {}): VerificationEvidenceInput {
  seq++;
  const { figures, ...rest } = over;
  return {
    evidenceId: `ev-${String(seq).padStart(3, "0")}`,
    sha256: shaOf(`img-${seq}`),
    contributorRef: `c-${seq}`,
    receivedAt: new Date(Date.UTC(2026, 10, 19, 12, 0, seq)).toISOString(),
    synthetic: true,
    latestDecision: "ACCEPTED",
    independence: "REVIEWER_CONFIRMED",
    confirmed: { revisionNumber: 2, formType: "EC8A", figures: figures ?? { ...WITNESS } },
    ...rest,
  };
}

function ref(over: Partial<VerificationReferenceInput> = {}): VerificationReferenceInput {
  return {
    id: "ref-1",
    version: 1,
    sourceType: "SYNTHETIC_DEMO",
    sourceDescription: "Synthetic demo reference (fictional)",
    sourceUrl: null,
    sourceVerified: true,
    // Keep reviewState consistent with sourceVerified unless a test overrides it.
    reviewState: over.sourceVerified === false ? "NOT_REVIEWED" : "CONFIRMED",
    synthetic: true,
    figures: { ...fixture.referenceResult },
    ...over,
  };
}

function input(evidence: VerificationEvidenceInput[], reference: VerificationReferenceInput | null = null): VerificationInput {
  return { electionId: "demo-election", pollingUnitId: "demo-pu-012", partyRoster: ROSTER, evidence, reference };
}

function scenarioInput(s: Scenario): VerificationInput {
  const evidence = s.images.map((img, i) =>
    ev({
      sha256: shaOf(img),
      independence: s.independence,
      figures: { ...WITNESS, ...(s.votesB ? { PARTY_B: s.votesB[i] } : {}) },
    }),
  );
  const reference =
    s.reference === null ? null : s.referenceSourceVerified !== undefined ? ref({ sourceVerified: s.referenceSourceVerified }) : null;
  return input(evidence, reference);
}

const BANNED = /\b(fraud\w*|rigged|rigging|verified|authentic\w*|official\w*|INEC)\b/i;
const allOutputs: UnitVerification[] = [];
function run(i: VerificationInput) {
  const out = computeVerification(i);
  expect(UnitVerification.safeParse(out).success).toBe(true);
  allOutputs.push(out);
  return out;
}

describe("fixture scenarios (fixtures/demo_cases.json)", () => {
  it.each(fixture.scenarios.map((s) => [s.id, s] as const))("%s", (_id, s) => {
    const out = run(scenarioInput(s));
    expect(out.status).toBe(s.expectedStatus);
    expect(out.synthetic).toBe(true);

    if (s.id === "corroborated-and-reference-discrepancy") {
      const b = out.differences.find((d) => d.partyCode === "PARTY_B")!;
      expect(b).toEqual({ partyCode: "PARTY_B", witness: 210, reference: 270, referenceMinusWitness: 60 });
      expect(b.referenceMinusWitness).toBe(fixture.expectedReferenceMinusWitness.PARTY_B);
      expect(out.differences.filter((d) => d.partyCode !== "PARTY_B").every((d) => d.referenceMinusWitness === 0)).toBe(true);
      expect(out.differenceUnconfirmed).toBe(false);
      expect(out.reasons).toContain(
        "Reference is 60 higher for PARTY_B (270 vs 210). This is a difference to check, not proof of wrongdoing.",
      );
    }
    if (s.id === "conflicting-witnesses") {
      expect(out.conflictingParties).toEqual(["PARTY_B"]);
      expect(out.witnessFigures).toEqual({ PARTY_A: 145, PARTY_B: null, PARTY_C: 42 });
    }
    if (s.id === "same-photo-twice") {
      expect(out.distinctOriginals).toBe(1);
      const [kept, dup] = out.members;
      expect(kept.eligible).toBe(true);
      expect(dup).toMatchObject({ eligible: false, duplicateOf: kept.evidenceId, excludedReason: EXCLUDED.DUPLICATE });
    }
    if (s.id === "matching-unverified") {
      expect(out.independentSources).toBe(0);
      expect(out.reasons[0]).toMatch(/not independent witnesses until a reviewer confirms independence/);
    }
    if (s.id === "missing-reference") {
      expect(out.differences).toEqual([]);
      expect(out.differenceUnconfirmed).toBe(false);
    }
  });
});

describe("additional cases", () => {
  it("NO_EVIDENCE", () => {
    const out = run(input([], ref()));
    expect(out).toMatchObject({ status: "NO_EVIDENCE", formType: null, witnessFigures: null, distinctOriginals: 0 });
  });

  it.each<{ decision: ReviewDecision | null; confirmed: boolean; status: VerificationStatus; reason: string }>([
    { decision: null, confirmed: true, status: "PENDING_REVIEW", reason: EXCLUDED.NOT_REVIEWED },
    { decision: "FLAGGED", confirmed: true, status: "PENDING_REVIEW", reason: EXCLUDED.FLAGGED },
    { decision: "REJECTED", confirmed: true, status: "INCONCLUSIVE", reason: EXCLUDED.REJECTED },
    { decision: "ACCEPTED", confirmed: false, status: "INCONCLUSIVE", reason: EXCLUDED.NOT_CONFIRMED },
  ])("no eligible: decision=$decision confirmed=$confirmed → $status", ({ decision, confirmed, status, reason }) => {
    const e = ev({ latestDecision: decision });
    if (!confirmed) e.confirmed = null;
    const out = run(input([e]));
    expect(out.status).toBe(status);
    expect(out.members[0]).toMatchObject({ eligible: false, excludedReason: reason });
    expect(out.witnessFigures).toBeNull();
  });

  it("unverified reference with +60 is not a REFERENCE_DISCREPANCY; difference is unconfirmed", () => {
    const out = run(input([ev(), ev()], ref({ sourceVerified: false })));
    expect(out.status).toBe("CORROBORATED");
    expect(out.differenceUnconfirmed).toBe(true);
    expect(out.differences.find((d) => d.partyCode === "PARTY_B")!.referenceMinusWitness).toBe(60);
    expect(out.reasons.some((r) => r.startsWith("Unconfirmed: Reference is 60 higher for PARTY_B"))).toBe(true);
  });

  it.each([
    { independence: "UNVERIFIED" as const, status: "MATCHING_SUBMISSIONS" },
    { independence: "DISPUTED" as const, status: "MATCHING_SUBMISSIONS" },
  ])("verified reference but $independence witnesses → $status, unconfirmed", ({ independence, status }) => {
    const out = run(input([ev({ independence }), ev({ independence })], ref()));
    expect(out.status).toBe(status);
    expect(out.independentSources).toBe(0);
    expect(out.differenceUnconfirmed).toBe(true);
  });

  it("same contributor twice (REVIEWER_CONFIRMED) counts as one independent source", () => {
    const out = run(input([ev({ contributorRef: "same" }), ev({ contributorRef: "same" })], ref()));
    expect(out.distinctOriginals).toBe(2);
    expect(out.independentSources).toBe(1);
    expect(out.status).toBe("MATCHING_SUBMISSIONS");
    expect(out.differenceUnconfirmed).toBe(true);
  });

  it("DISPUTED is excluded from independence", () => {
    const out = run(input([ev(), ev({ independence: "DISPUTED" })]));
    expect(out.independentSources).toBe(1);
    expect(out.status).toBe("MATCHING_SUBMISSIONS");
    expect(out.reasons.some((r) => r.includes("disputed independence"))).toBe(true);
  });

  it.each([
    { forms: ["EC8A", "EC60E", "EC8A"] as const, expected: "EC8A", excluded: 1 },
    { forms: ["EC60E", "EC60E", "EC8A"] as const, expected: "EC60E", excluded: 1 },
    { forms: ["EC60E", "EC8A"] as const, expected: "EC8A", excluded: 1 }, // tie → EC8A
    { forms: ["UNKNOWN", "EC60E"] as const, expected: "EC60E", excluded: 1 }, // tie → lexical
  ])("form type mismatch $forms → compares $expected", ({ forms, expected, excluded }) => {
    const out = run(
      input(forms.map((f) => ev({ confirmed: { revisionNumber: 2, formType: f, figures: { ...WITNESS } } }))),
    );
    expect(out.formType).toBe(expected);
    expect(out.members.filter((m) => m.excludedReason === EXCLUDED.FORM_TYPE)).toHaveLength(excluded);
  });

  it("null party figure is not compared and is named in reasons", () => {
    const out = run(input([ev(), ev({ figures: { ...WITNESS, PARTY_B: null } })], ref()));
    expect(out.status).toBe("CORROBORATED");
    expect(out.witnessFigures).toEqual({ PARTY_A: 145, PARTY_B: null, PARTY_C: 42 });
    expect(out.differences.find((d) => d.partyCode === "PARTY_B")!.referenceMinusWitness).toBeNull();
    expect(out.differenceUnconfirmed).toBe(true);
    expect(out.reasons).toContain("PARTY_B could not be read on every accepted photo, so it is not compared.");
  });

  it("missing party key is treated as unknown, not zero", () => {
    const out = run(input([ev({ figures: { PARTY_A: 145, PARTY_B: 210 } }), ev()]));
    expect(out.witnessFigures!.PARTY_C).toBeNull();
    expect(out.conflictingParties).toEqual([]);
  });

  it("all figures unknown → INCONCLUSIVE", () => {
    const blank = { PARTY_A: null, PARTY_B: null, PARTY_C: null };
    const out = run(input([ev({ figures: blank }), ev({ figures: blank })]));
    expect(out.status).toBe("INCONCLUSIVE");
  });

  it("reference agrees exactly → CORROBORATED with zero differences", () => {
    const out = run(input([ev(), ev()], ref({ figures: { ...WITNESS } })));
    expect(out.status).toBe("CORROBORATED");
    expect(out.differences.map((d) => d.referenceMinusWitness)).toEqual([0, 0, 0]);
    expect(out.differenceUnconfirmed).toBe(false);
    expect(out.reasons).toContain("The reference figures are the same as the witness figures for every party.");
  });

  it("reference lower gives a negative signed difference", () => {
    const out = run(input([ev(), ev()], ref({ figures: { ...WITNESS, PARTY_A: 140 } })));
    expect(out.status).toBe("REFERENCE_DISCREPANCY");
    expect(out.differences[0].referenceMinusWitness).toBe(-5);
    expect(out.reasons).toContain(
      "Reference is 5 lower for PARTY_A (140 vs 145). This is a difference to check, not proof of wrongdoing.",
    );
  });

  it("conflict takes precedence over a verified reference difference", () => {
    const out = run(input([ev(), ev({ figures: { ...WITNESS, PARTY_B: 215 } })], ref()));
    expect(out.status).toBe("CONFLICTING_EVIDENCE");
    expect(out.differences.find((d) => d.partyCode === "PARTY_B")).toMatchObject({ witness: null, referenceMinusWitness: null });
    expect(out.differenceUnconfirmed).toBe(true);
  });

  it("duplicate keeps earliest receivedAt; tie broken by evidenceId", () => {
    const sha = shaOf("dup");
    const t = "2026-11-19T12:00:00.000Z";
    const out = run(input([ev({ evidenceId: "b", sha256: sha, receivedAt: t }), ev({ evidenceId: "a", sha256: sha, receivedAt: t })]));
    expect(out.members.find((m) => m.evidenceId === "a")!.eligible).toBe(true);
    expect(out.members.find((m) => m.evidenceId === "b")!.duplicateOf).toBe("a");
    expect(out.status).toBe("INCONCLUSIVE");
  });

  it("pending photos are mentioned alongside an eligible result", () => {
    const out = run(input([ev(), ev({ latestDecision: null })]));
    expect(out.status).toBe("INCONCLUSIVE");
    expect(out.reasons).toContain("1 more photo is waiting for review.");
  });

  it("synthetic flag from reference only", () => {
    const out = run(input([ev({ synthetic: false }), ev({ synthetic: false })], ref({ synthetic: true })));
    expect(out.synthetic).toBe(true);
    const out2 = run(input([ev({ synthetic: false })], null));
    expect(out2.synthetic).toBe(false);
  });

  it("rejects invalid input", () => {
    expect(() => computeVerification({ ...input([]), partyRoster: [] })).toThrow();
    expect(() => computeVerification(input([{ ...ev(), sha256: "NOT-HEX" }]))).toThrow();
  });
});

describe("determinism", () => {
  const cases: Array<[string, VerificationInput]> = [
    ["conflict + duplicate + pending + form mismatch", input([
      ev({ sha256: shaOf("x") }),
      ev({ sha256: shaOf("x") }),
      ev({ figures: { ...WITNESS, PARTY_B: 215 } }),
      ev({ latestDecision: null }),
      ev({ confirmed: { revisionNumber: 1, formType: "EC60E", figures: { ...WITNESS } } }),
    ], ref())],
    ["discrepancy", input([ev(), ev(), ev({ independence: "DISPUTED" })], ref())],
  ];
  it.each(cases)("%s: shuffled evidence order → identical output", (_n, i) => {
    const base = computeVerification(i);
    const variants = [[...i.evidence].reverse(), [i.evidence[1], ...i.evidence.filter((_, k) => k !== 1)]];
    for (const evs of variants) expect(computeVerification({ ...i, evidence: evs })).toEqual(base);
  });
});

describe("neutral language", () => {
  it("no reason ever uses accusatory or certification words", () => {
    expect(allOutputs.length).toBeGreaterThan(15);
    for (const out of allOutputs) {
      expect(out.reasons.length).toBeGreaterThan(0);
      for (const r of out.reasons) expect(r).not.toMatch(BANNED);
    }
  });
});
