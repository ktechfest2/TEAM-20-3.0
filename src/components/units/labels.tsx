import { Ban, Clock, Copy, Hourglass, ShieldCheck, ShieldQuestion, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import type { ReferenceType, VerificationStatus } from "@/lib/contracts";
import type { Tone } from "@/components/stamp";
import { partyLabel } from "@/components/client/format";

/** Fixed demo election for this build (registry ELECTIONS[0]). */
export const DEMO_ELECTION_ID = "demo-election";

export const REFERENCE_TYPE_LINE: Record<ReferenceType, string> = {
  SYNTHETIC_DEMO: "Synthetic demo reference (not real)",
  MANUAL_IREV: "Typed in by a reviewer from a public IReV page",
  HISTORICAL_DATASET: "From a historical dataset",
};

export const partyList = (codes: string[]) => {
  const names = codes.map(partyLabel);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

type StatusMeta = {
  stamp: string;
  icon: LucideIcon;
  tone: Tone;
  means: (ctx: { distinct: number; independent: number; parties: string }) => string;
  doesNotMean: string;
};

/** Red is never used here. Amber only for DIFFERS FROM REFERENCE and SUBMISSIONS DISAGREE. */
export const STATUS_META: Record<VerificationStatus, StatusMeta> = {
  NO_EVIDENCE: {
    stamp: "No evidence yet",
    icon: Hourglass,
    tone: "outline",
    means: () => "No photos of the result sheet have been received for this polling unit.",
    doesNotMean: "It does not mean anything is wrong. Nobody has sent a photo yet.",
  },
  PENDING_REVIEW: {
    stamp: "Waiting for review",
    icon: Clock,
    tone: "local",
    means: () => "Photos were received, but a reviewer has not accepted any with confirmed figures yet.",
    doesNotMean: "No comparison has been made yet.",
  },
  MATCHING_SUBMISSIONS: {
    stamp: "Matching submissions",
    icon: Copy,
    tone: "tealOutline",
    means: ({ distinct }) => `${distinct} different photos show the same figures.`,
    doesNotMean:
      "A reviewer has not confirmed that they came from independent people, so this is not corroboration.",
  },
  CORROBORATED: {
    stamp: "Corroborated",
    icon: Users,
    tone: "progress",
    means: ({ independent }) =>
      `${independent} photos that a reviewer judged to come from independent people show the same figures.`,
    doesNotMean: "This is not an official result. Only INEC declares results.",
  },
  CONFLICTING_EVIDENCE: {
    stamp: "Submissions disagree",
    icon: TriangleAlert,
    tone: "attention",
    means: ({ parties }) => `Accepted photos show different figures for ${parties || "some parties"}.`,
    doesNotMean: "PollTrace does not pick which photo is right.",
  },
  REFERENCE_DISCREPANCY: {
    stamp: "Differs from reference",
    icon: TriangleAlert,
    tone: "attention",
    means: ({ parties }) =>
      `The reviewed witness figures differ from the reference record for ${parties || "some parties"}.`,
    doesNotMean: "It does not show that either record is wrong, or that anyone did anything wrong.",
  },
  INCONCLUSIVE: {
    stamp: "Not enough to compare",
    icon: Ban,
    tone: "outline",
    means: () => "",
    doesNotMean: "A possible difference may be shown below, but it is not confirmed.",
  },
};

export const PROVENANCE = {
  CONFIRMED: {
    stamp: "Source confirmed by a second reviewer",
    icon: ShieldCheck,
    tone: "tealOutline" as Tone,
    text: "A different reviewer from the one who added it checked where this record came from. This is not certification by INEC.",
  },
  REJECTED: {
    stamp: "Source not accepted",
    icon: ShieldQuestion,
    tone: "outline" as Tone,
    text: "A second reviewer did not accept where this record came from, so differences with it are not confirmed.",
  },
  NOT_REVIEWED: {
    stamp: "Source not confirmed",
    icon: ShieldQuestion,
    tone: "outline" as Tone,
    text: "A second reviewer has not confirmed where this record came from, so differences with it are not confirmed.",
  },
};

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
export const higherLower = (n: number) => `Reference is ${Math.abs(n)} ${n > 0 ? "higher" : "lower"}`;
