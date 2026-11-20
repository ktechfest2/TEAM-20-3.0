/** Display helpers shared by evidence, figures and review screens. Wording is neutral by design. */
import type { EvidenceSource, Independence, ReviewDecision } from "@/lib/contracts";

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function partyLabel(code: string): string {
  const m = /^PARTY_([A-Z0-9]+)$/.exec(code);
  return m ? `Party ${m[1]}` : code;
}

export function fileLine(mime: string, bytes: number): string {
  const kind = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" }[mime] ?? mime;
  const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${kind} · ${size}`;
}

export const SOURCE_LONG: Record<EvidenceSource, string> = {
  WITNESS_PHOTO: "A voter or witness at this polling unit",
  OBSERVER_PHOTO: "An accredited observer or party agent",
};
export const SOURCE_SHORT: Record<EvidenceSource, string> = {
  WITNESS_PHOTO: "Voter or witness (own statement)",
  OBSERVER_PHOTO: "Observer or party agent (own statement)",
};

export const INDEPENDENCE_LINE: Record<Independence, string> = {
  UNVERIFIED: "Not assessed",
  REVIEWER_CONFIRMED: "Reviewer judged independent",
  DISPUTED: "Reviewer judged not independent",
};

export const DECISION_WORD: Record<ReviewDecision, string> = {
  ACCEPTED: "Accepted",
  REJECTED: "Not accepted",
  FLAGGED: "Flagged",
};

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Reviewer display name: server aliases like "Synthetic Demo Reviewer A" are shown as "Reviewer A". */
export const displayAlias = (alias: string | undefined | null) =>
  alias ? alias.replace(/^(synthetic\s+)?(demo\s+)?(sample\s+)?/i, "").replace(/^reviewer/i, "Reviewer") : "a reviewer";
