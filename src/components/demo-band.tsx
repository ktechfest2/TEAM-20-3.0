/**
 * Record markers. Minimal labelling: one quiet footer line (layout) explains both kinds of record,
 * and a small neutral tag sits next to unit names so sample (fictional) and real 2023 units are
 * never confused. Both tags use the same neutral outline; neither uses colour alone.
 */

/** Next to a sample (fictional, code 99-…) polling unit's name. */
export function SampleTag() {
  return (
    <span className="inline-flex items-center rounded-sm border border-control bg-surface px-1.5 align-middle text-xs leading-5 font-bold whitespace-nowrap text-ink">
      Sample<span className="sr-only"> unit, fictional</span>
    </span>
  );
}

/** Next to a real 2023 historical polling unit's name. */
export function HistoricalTag() {
  return (
    <span className="inline-flex items-center rounded-sm border border-control bg-surface px-1.5 align-middle text-xs leading-5 font-bold whitespace-nowrap text-ink">
      2023 historical<span className="sr-only"> record</span>
    </span>
  );
}

/** The right marker for a unit: "Sample" for fictional units, "2023 historical" for real ones. */
export function RecordTag({ synthetic }: { synthetic: boolean }) {
  return synthetic ? <SampleTag /> : <HistoricalTag />;
}
