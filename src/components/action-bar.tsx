import type { ReactNode } from "react";

/** Sticky bottom bar for task screens: at most one primary and one secondary action. */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <>
      {/* Spacer so content never hides behind the bar. */}
      <div aria-hidden className="h-44" />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-surface shadow-bar">
        <div className="mx-auto flex max-w-xl flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {note}
          {children}
        </div>
      </div>
    </>
  );
}
