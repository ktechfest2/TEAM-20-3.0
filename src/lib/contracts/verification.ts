/**
 * FROZEN CONTRACT (lead-owned, 2026-11-19): deterministic per-polling-unit comparison.
 * Rules: docs/CONTRACTS.md "Comparison contract". Deterministic code decides equality, not truth.
 * Matching photos are not independent witnesses; a discrepancy is not an allegation.
 */
import { z } from "zod";
import { FormType, Independence, ReferenceType, ReviewDecision, Sha256Hex, VerificationStatus } from "./index";

const Votes = z.number().int().min(0).nullable();

/** One evidence row as the engine sees it (assembled by the server from storage). */
export const VerificationEvidenceInput = z.object({
  evidenceId: z.string(),
  sha256: Sha256Hex,
  /** Opaque, stable per submitting contributor (never identity). Same ref = same submitter. */
  contributorRef: z.string(),
  receivedAt: z.iso.datetime(),
  synthetic: z.boolean(),
  /** Latest review decision (null = not reviewed). */
  latestDecision: ReviewDecision.nullable(),
  /** Independence recorded with the latest review (UNVERIFIED when not reviewed). */
  independence: Independence,
  /** Latest revision, only if it is human-confirmed; otherwise null. */
  confirmed: z
    .object({
      revisionNumber: z.number().int().min(1),
      formType: FormType,
      figures: z.record(z.string(), Votes),
    })
    .nullable(),
});
export type VerificationEvidenceInput = z.infer<typeof VerificationEvidenceInput>;

export const VerificationReferenceInput = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  sourceType: ReferenceType,
  sourceDescription: z.string(),
  sourceUrl: z.string().nullable(),
  /** Provenance reviewed by an authorised reviewer. NOT INEC certification. */
  sourceVerified: z.boolean(),
  synthetic: z.boolean(),
  figures: z.record(z.string(), z.number().int().min(0)),
});
export type VerificationReferenceInput = z.infer<typeof VerificationReferenceInput>;

export const VerificationInput = z.object({
  electionId: z.string(),
  pollingUnitId: z.string(),
  partyRoster: z.array(z.string()).min(1),
  evidence: z.array(VerificationEvidenceInput),
  /** Latest reference version for this election + unit, if any. */
  reference: VerificationReferenceInput.nullable(),
});
export type VerificationInput = z.infer<typeof VerificationInput>;

export const VerificationMember = z.object({
  evidenceId: z.string(),
  sha256: Sha256Hex,
  revisionNumber: z.number().int().nullable(),
  independence: Independence,
  /** Counted towards the comparison (accepted, confirmed, first of its exact-hash group). */
  eligible: z.boolean(),
  /** Why not eligible (plain language), null when eligible. */
  excludedReason: z.string().nullable(),
  /** When excluded as an exact duplicate: the evidence id it duplicates. */
  duplicateOf: z.string().nullable(),
});
export type VerificationMember = z.infer<typeof VerificationMember>;

export const FieldDifference = z.object({
  partyCode: z.string(),
  /** Agreed witness figure (null when witnesses disagree or none eligible). */
  witness: Votes,
  reference: Votes,
  /** Signed, from the reference perspective: reference − witness. Null if either is unknown. */
  referenceMinusWitness: z.number().int().nullable(),
});
export type FieldDifference = z.infer<typeof FieldDifference>;

export const UnitVerification = z.object({
  electionId: z.string(),
  pollingUnitId: z.string(),
  formType: FormType.nullable(),
  status: VerificationStatus,
  /** Ordered plain-language reasons for the status; first is the headline. Never accusatory. */
  reasons: z.array(z.string()).min(1),
  members: z.array(VerificationMember),
  /** Eligible evidence after exact-duplicate collapse. */
  distinctOriginals: z.number().int().min(0),
  /** Eligible distinct originals whose independence a reviewer confirmed (and distinct submitters). */
  independentSources: z.number().int().min(0),
  /** Party → agreed witness figure; null when there is no agreement. */
  witnessFigures: z.record(z.string(), Votes).nullable(),
  /** Parties where eligible witnesses disagree. */
  conflictingParties: z.array(z.string()),
  reference: VerificationReferenceInput.nullable(),
  /** Per-party comparison with the reference (empty when no reference). */
  differences: z.array(FieldDifference),
  /** True when reference differences are shown but not confirmed (reference or witnesses not eligible). */
  differenceUnconfirmed: z.boolean(),
  synthetic: z.boolean(),
});
export type UnitVerification = z.infer<typeof UnitVerification>;
