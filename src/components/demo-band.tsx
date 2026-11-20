import { Info } from "lucide-react";
import { ReviewerStrip } from "@/components/shell/reviewer-strip";

/**
 * Page-level test-build notice. Not dismissible, deliberately quiet. Its text is true for both
 * kinds of records in this build: synthetic demo units (marked DEMO on each item) and a small
 * historical 2023 sample (marked "2023 historical"). Violet/dashed stays reserved for the
 * per-item DEMO tag. The reviewer identity strip sits directly under it.
 */
export function DemoBand() {
  return (
    <>
      <div role="note" aria-label="Test build notice" className="border-b border-rule bg-sunken text-ink">
        <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-1.5 text-sm">
          <Info aria-hidden size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            <strong>Test build</strong> · Units marked <DemoTag /> are synthetic. 2023 records are historical
            (independent crosscheck, not INEC-certified).
          </span>
        </p>
      </div>
      <ReviewerStrip />
    </>
  );
}

/**
 * Neutral marker for real historical records (never violet or dashed: that means synthetic).
 * Screen readers hear "2023 historical record".
 */
export function HistoricalTag() {
  return (
    <span className="inline-flex items-center rounded-sm border border-control bg-surface px-1.5 align-middle text-xs leading-5 font-bold whitespace-nowrap text-ink">
      2023 historical<span className="sr-only"> record</span>
    </span>
  );
}

/** The right per-item marker for a record: DEMO for synthetic, "2023 historical" for real. */
export function RecordTag({ synthetic }: { synthetic: boolean }) {
  return synthetic ? <DemoTag /> : <HistoricalTag />;
}

export function DemoTag() {
  return (
    <span className="demo-tag">
      DEMO<span className="sr-only"> data</span>
    </span>
  );
}
