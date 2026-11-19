import type { Metadata } from "next";
import { Suspense } from "react";
import { ReferencesScreen } from "./references-screen";

export const metadata: Metadata = { title: "Reference records" };

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReferencesScreen id={id} />;
}

export default function ReferencesPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <Suspense fallback={<p className="text-ink-muted">Loading reference records…</p>}>
        <Resolved params={params} />
      </Suspense>
    </div>
  );
}
