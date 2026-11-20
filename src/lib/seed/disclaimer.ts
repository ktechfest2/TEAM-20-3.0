import { SYNTHETIC_DISCLAIMER } from "./registry";

export const HISTORICAL_DISCLAIMER =
  "HISTORICAL 2023 DATA — Nigeria 2.0 independent crosscheck sample, not INEC-certified";

/**
 * Honest top-level summary for a list of registry records: `synthetic` is true only when every
 * record is fictional; `disclaimer` names each kind of data present (sample and/or historical).
 */
export function describeRecords(records: ReadonlyArray<{ synthetic: boolean }>): {
  synthetic: boolean;
  disclaimer: string;
} {
  const hasSample = records.some((r) => r.synthetic);
  const hasReal = records.some((r) => !r.synthetic);
  const parts = [hasSample ? SYNTHETIC_DISCLAIMER : null, hasReal ? HISTORICAL_DISCLAIMER : null].filter(
    (p): p is string => p !== null,
  );
  return {
    synthetic: records.length > 0 && !hasReal,
    disclaimer: parts.join(" · ") || "No records",
  };
}
