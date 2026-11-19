import type { Metadata } from "next";
import { Suspense } from "react";
import { CaptureFlow } from "./capture-flow";

export const metadata: Metadata = { title: "Capture a result" };

export default function CapturePage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>
        <CaptureFlow />
      </Suspense>
    </div>
  );
}
