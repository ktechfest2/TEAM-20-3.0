import { FlaskConical } from "lucide-react";
import { ReviewerStrip } from "@/components/shell/reviewer-strip";

/**
 * Page-level synthetic-data notice. Not dismissible. In this build the only registry is the
 * synthetic demo registry, so every screen renders it. The reviewer identity strip sits directly
 * under it (renders nothing for capturer sessions), so it appears on every page too.
 */
export function DemoBand() {
  return (
    <>
    <div role="note" aria-label="Demo data notice" className="border-y-2 border-dashed border-demo bg-demo-tint text-demo">
      <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm">
        <FlaskConical aria-hidden size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
        <span>
          <strong className="tracking-wide">DEMO DATA</strong>{" "}
          <span className="block sm:inline">Synthetic. Not real election results.</span>
        </span>
      </p>
    </div>
    <ReviewerStrip />
    </>
  );
}

export function DemoTag() {
  return (
    <span className="demo-tag">
      DEMO<span className="sr-only"> data</span>
    </span>
  );
}
