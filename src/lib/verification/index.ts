/**
 * Deterministic per-polling-unit comparison engine (pure; no storage, no network, no AI).
 *
 * It decides only whether reviewed, human-confirmed figures are EQUAL. It never decides truth,
 * authenticity or wrongdoing. Rules follow docs/CONTRACTS.md "Comparison contract" and are
 * numbered R1..R10 below so tests and reviewers can trace each one.
 *
 * R1  Eligible = latestDecision ACCEPTED and a human-confirmed revision exists.
 * R2  Exact-duplicate collapse: among eligible, same sha256 → earliest receivedAt (tie: evidenceId)
 *     is kept; the rest are excluded with duplicateOf. Same bytes are never two witnesses.
 * R3  Form type: compare the most common form type among eligible (tie: EC8A, then A–Z);
 *     others are excluded as "Different form type".
 * R4  independentSources = eligible distinct originals marked REVIEWER_CONFIRMED, at most one per
 *     contributorRef. UNVERIFIED and DISPUTED never count.
 * R5  Per-party agreement: a party figure is "agreed" only when EVERY eligible witness read it and
 *     all values are equal. Different known values → conflicting. Any unknown (null/missing) →
 *     no agreed figure (null) and the party is named in reasons; it never produces a match claim.
 * R6  Status precedence:
 *       1 NO_EVIDENCE           no evidence rows at all
 *       2 PENDING_REVIEW        none eligible and something is unreviewed or flagged
 *         INCONCLUSIVE          none eligible otherwise (rejected / unconfirmed)
 *       3 CONFLICTING_EVIDENCE  any conflicting party (no winner is chosen)
 *       3b INCONCLUSIVE         eligible exist but no party has an agreed figure (nothing to compare)
 *       4 REFERENCE_DISCREPANCY reference source-reviewed AND ≥2 independent sources AND a non-zero
 *                               difference on a party where both figures are known
 *       5 CORROBORATED          ≥2 independent sources
 *       6 MATCHING_SUBMISSIONS  ≥2 distinct originals (independence not confirmed)
 *       7 INCONCLUSIVE          one distinct original (or copies of one photo)
 * R7  differences: one row per roster party when a reference exists;
 *     referenceMinusWitness = reference − witness (signed, reference perspective), null if unknown.
 * R8  differenceUnconfirmed = reference present AND status ≠ REFERENCE_DISCREPANCY AND any
 *     difference is non-zero or unknown.
 * R9  reasons: ordered, plain language, neutral; first is the headline. Never accusatory.
 * R10 synthetic = any evidence row or the reference is synthetic.
 *
 * Output is deterministic: members are sorted by (receivedAt, evidenceId), so input order
 * never changes the result.
 */
import type { FormType, ReviewDecision, VerificationStatus } from "@/lib/contracts";
import {
  UnitVerification,
  VerificationInput,
  type FieldDifference,
  type VerificationEvidenceInput,
  type VerificationMember,
} from "@/lib/contracts/verification";

export const EXCLUDED = {
  NOT_REVIEWED: "Not reviewed yet",
  REJECTED: "Not accepted by a reviewer",
  FLAGGED: "Flagged for another look",
  NOT_CONFIRMED: "Figures not confirmed by a person",
  DUPLICATE: "Exact copy of another photo — counted once",
  FORM_TYPE: "Different form type",
} as const;

const FORM_TIE_ORDER: readonly FormType[] = ["EC8A", "EC60E", "UNKNOWN"];

function byReceivedThenId(a: VerificationEvidenceInput, b: VerificationEvidenceInput): number {
  const t = Date.parse(a.receivedAt) - Date.parse(b.receivedAt);
  if (t !== 0) return t;
  return a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0;
}

/** R1: reason an evidence row is not eligible, or null when eligible. */
function ineligibleReason(e: VerificationEvidenceInput): string | null {
  const d: ReviewDecision | null = e.latestDecision;
  if (d === null) return EXCLUDED.NOT_REVIEWED;
  if (d === "FLAGGED") return EXCLUDED.FLAGGED;
  if (d === "REJECTED") return EXCLUDED.REJECTED;
  if (e.confirmed === null) return EXCLUDED.NOT_CONFIRMED;
  return null;
}

/** R3: most common form type; tie → EC8A, then lexical. */
function pickFormType(forms: FormType[]): FormType | null {
  if (forms.length === 0) return null;
  const counts = new Map<FormType, number>();
  for (const f of forms) counts.set(f, (counts.get(f) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const tied = [...counts.keys()].filter((f) => counts.get(f) === max);
  tied.sort((a, b) => {
    if (a === "EC8A") return -1;
    if (b === "EC8A") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return tied[0] ?? FORM_TIE_ORDER[0];
}

/**
 * Human label for a party code, so public reasons never show raw codes.
 * "PARTY_B" → "Party B"; any code made of A–Z/0–9 words joined by "_" is split and title-cased.
 * Any other shape (no "_", lower case, punctuation) is returned unchanged.
 */
export function partyLabel(code: string): string {
  if (!/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(code)) return code;
  return code
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/** "a", "a and b", "a, b and c" — deterministic list joining for reasons. */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function computeVerification(rawInput: VerificationInput): UnitVerification {
  const input = VerificationInput.parse(rawInput);
  const roster = input.partyRoster;
  const reference = input.reference;
  const evidence = [...input.evidence].sort(byReceivedThenId);

  // Mutable working state per evidence id.
  const state = new Map<string, { eligible: boolean; reason: string | null; duplicateOf: string | null }>();
  for (const e of evidence) {
    const reason = ineligibleReason(e);
    state.set(e.evidenceId, { eligible: reason === null, reason, duplicateOf: null });
  }

  // R2: exact-duplicate collapse among eligible (evidence already sorted → first seen is kept).
  const keptBySha = new Map<string, string>();
  let duplicatesCollapsed = 0;
  for (const e of evidence) {
    const s = state.get(e.evidenceId)!;
    if (!s.eligible) continue;
    const kept = keptBySha.get(e.sha256);
    if (kept === undefined) {
      keptBySha.set(e.sha256, e.evidenceId);
    } else {
      s.eligible = false;
      s.reason = EXCLUDED.DUPLICATE;
      s.duplicateOf = kept;
      duplicatesCollapsed++;
    }
  }

  // R3: form type grouping.
  const formType = pickFormType(
    evidence.filter((e) => state.get(e.evidenceId)!.eligible).map((e) => e.confirmed!.formType),
  );
  let formExcluded = 0;
  for (const e of evidence) {
    const s = state.get(e.evidenceId)!;
    if (s.eligible && e.confirmed!.formType !== formType) {
      s.eligible = false;
      s.reason = EXCLUDED.FORM_TYPE;
      formExcluded++;
    }
  }

  const eligible = evidence.filter((e) => state.get(e.evidenceId)!.eligible);
  const distinctOriginals = eligible.length; // one per sha after R2

  // R4: independent sources (one per submitter, reviewer-confirmed only).
  const independentContributors = new Set(
    eligible.filter((e) => e.independence === "REVIEWER_CONFIRMED").map((e) => e.contributorRef),
  );
  const independentSources = independentContributors.size;
  const disputedCount = eligible.filter((e) => e.independence === "DISPUTED").length;
  const sameSubmitterRepeats =
    eligible.filter((e) => e.independence === "REVIEWER_CONFIRMED").length - independentSources;

  // R5: per-party agreement.
  const conflictingParties: string[] = [];
  const partlyUnknown: string[] = [];
  const conflictDetail: string[] = [];
  let witnessFigures: Record<string, number | null> | null = null;
  if (eligible.length > 0) {
    witnessFigures = {};
    for (const party of roster) {
      const values = eligible.map((e) => e.confirmed!.figures[party] ?? null);
      const known = values.filter((v): v is number => v !== null);
      const distinct = [...new Set(known)].sort((a, b) => a - b);
      if (distinct.length > 1) {
        conflictingParties.push(party);
        conflictDetail.push(`${partyLabel(party)}: photos show ${joinList(distinct.map(String))}.`);
        witnessFigures[party] = null;
      } else if (known.length < values.length) {
        partlyUnknown.push(party);
        witnessFigures[party] = null;
      } else {
        witnessFigures[party] = distinct[0] ?? null;
      }
    }
  }
  const agreedParties = witnessFigures
    ? roster.filter((p) => witnessFigures![p] !== null)
    : [];

  // R7: differences against the reference.
  const differences: FieldDifference[] = reference
    ? roster.map((partyCode) => {
        const witness = witnessFigures?.[partyCode] ?? null;
        const ref = reference.figures[partyCode] ?? null;
        return {
          partyCode,
          witness,
          reference: ref,
          referenceMinusWitness: witness !== null && ref !== null ? ref - witness : null,
        };
      })
    : [];
  const knownNonZero = differences.filter(
    (d) => d.referenceMinusWitness !== null && d.referenceMinusWitness !== 0,
  );

  // R6: status precedence.
  const pendingCount = evidence.filter(
    (e) => e.latestDecision === null || e.latestDecision === "FLAGGED",
  ).length;
  let status: VerificationStatus;
  if (evidence.length === 0) status = "NO_EVIDENCE";
  else if (eligible.length === 0) status = pendingCount > 0 ? "PENDING_REVIEW" : "INCONCLUSIVE";
  else if (conflictingParties.length > 0) status = "CONFLICTING_EVIDENCE";
  else if (agreedParties.length === 0) status = "INCONCLUSIVE";
  else if (reference && reference.sourceVerified && independentSources >= 2 && knownNonZero.length > 0)
    status = "REFERENCE_DISCREPANCY";
  else if (independentSources >= 2) status = "CORROBORATED";
  else if (distinctOriginals >= 2) status = "MATCHING_SUBMISSIONS";
  else status = "INCONCLUSIVE";

  // R8
  const differenceUnconfirmed =
    reference !== null &&
    status !== "REFERENCE_DISCREPANCY" &&
    differences.some((d) => d.referenceMinusWitness !== 0);

  // R9: reasons (headline first).
  const reasons: string[] = [];
  switch (status) {
    case "NO_EVIDENCE":
      reasons.push("No photos have been submitted for this polling unit yet.");
      break;
    case "PENDING_REVIEW":
      reasons.push(
        `${plural(pendingCount, "photo is", "photos are")} waiting for a reviewer. Nothing is compared until a photo is accepted and its figures are confirmed by a person.`,
      );
      break;
    case "CONFLICTING_EVIDENCE":
      reasons.push(
        `Accepted photos disagree on ${joinList(conflictingParties.map(partyLabel))}. No figure is treated as correct.`,
      );
      reasons.push(...conflictDetail);
      break;
    case "REFERENCE_DISCREPANCY":
      reasons.push(
        `The reference record shows different figures from the reviewed witness photos for ${joinList(knownNonZero.map((d) => partyLabel(d.partyCode)))}. This is a difference to check, not proof of wrongdoing.`,
      );
      break;
    case "CORROBORATED":
      reasons.push(
        `${independentSources} independent sources, confirmed by a reviewer, show the same figures.`,
      );
      break;
    case "MATCHING_SUBMISSIONS":
      reasons.push(
        `${distinctOriginals} different photos show the same figures. Matching photos are not independent witnesses until a reviewer confirms independence.`,
      );
      break;
    case "INCONCLUSIVE":
      if (eligible.length === 0) {
        reasons.push(
          "No photo has been accepted with figures confirmed by a person, so nothing can be compared.",
        );
      } else if (agreedParties.length === 0) {
        reasons.push(
          "No party figure could be read on every accepted photo, so nothing can be compared.",
        );
      } else if (duplicatesCollapsed > 0) {
        reasons.push(
          "All accepted submissions are copies of one photo, counted once. A second, different photo is needed to compare.",
        );
      } else {
        reasons.push(
          "Only one accepted photo so far. A second, different photo is needed to compare.",
        );
      }
      break;
  }

  if (duplicatesCollapsed > 0 && !reasons[0].includes("copies of one photo")) {
    reasons.push(
      `${plural(duplicatesCollapsed, "submission is an exact copy", "submissions are exact copies")} of another photo and counted once.`,
    );
  }
  if (formExcluded > 0) {
    reasons.push(
      `${plural(formExcluded, "photo uses", "photos use")} a different form type and ${formExcluded === 1 ? "is" : "are"} compared separately; comparing ${formType} only.`,
    );
  }
  if (sameSubmitterRepeats > 0) {
    reasons.push("Several photos came from the same submitter; they count as one independent source.");
  }
  if (disputedCount > 0) {
    reasons.push(
      `${plural(disputedCount, "photo has", "photos have")} disputed independence and ${disputedCount === 1 ? "does" : "do"} not count as an independent source.`,
    );
  }
  for (const party of partlyUnknown) {
    reasons.push(`${partyLabel(party)} could not be read on every accepted photo, so it is not compared.`);
  }

  if (reference && eligible.length > 0) {
    for (const d of knownNonZero) {
      const n = d.referenceMinusWitness!;
      const label =
        status === "REFERENCE_DISCREPANCY"
          ? partyLabel(d.partyCode)
          : `Unconfirmed difference for ${partyLabel(d.partyCode)}`;
      reasons.push(
        `${label}: the reference shows ${d.reference} and the reviewed witness figure is ${d.witness} (reference is ${Math.abs(n)} ${n > 0 ? "higher" : "lower"}). This is a difference to check, not proof of wrongdoing.`,
      );
    }
    if (!reference.sourceVerified) {
      reasons.push(
        "The reference source has not been reviewed yet, so any difference is shown as unconfirmed.",
      );
    } else if (status !== "REFERENCE_DISCREPANCY" && knownNonZero.length > 0 && independentSources < 2) {
      reasons.push(
        "Fewer than two independent sources, so any difference with the reference is unconfirmed.",
      );
    }
    const missingRef = differences.filter((d) => d.reference === null).map((d) => d.partyCode);
    if (missingRef.length) reasons.push(`The reference has no figure for ${joinList(missingRef.map(partyLabel))}.`);
    if (
      knownNonZero.length === 0 &&
      differences.length > 0 &&
      differences.every((d) => d.referenceMinusWitness === 0)
    ) {
      reasons.push("The reference figures are the same as the witness figures for every party.");
    }
  } else if (!reference && eligible.length > 0) {
    reasons.push("No reference result is available, so no comparison with a reference is made.");
  }

  if (pendingCount > 0 && status !== "PENDING_REVIEW") {
    reasons.push(`${plural(pendingCount, "more photo is", "more photos are")} waiting for review.`);
  }

  const members: VerificationMember[] = evidence.map((e) => {
    const s = state.get(e.evidenceId)!;
    return {
      evidenceId: e.evidenceId,
      sha256: e.sha256,
      revisionNumber: e.confirmed?.revisionNumber ?? null,
      independence: e.independence,
      eligible: s.eligible,
      excludedReason: s.eligible ? null : s.reason,
      duplicateOf: s.duplicateOf,
    };
  });

  // R10
  const synthetic = evidence.some((e) => e.synthetic) || (reference?.synthetic ?? false);

  return UnitVerification.parse({
    electionId: input.electionId,
    pollingUnitId: input.pollingUnitId,
    formType,
    status,
    reasons,
    members,
    distinctOriginals,
    independentSources,
    witnessFigures,
    conflictingParties,
    reference,
    differences,
    differenceUnconfirmed,
    synthetic,
  });
}
