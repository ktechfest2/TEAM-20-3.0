import type { Metadata } from "next";
import { Suspense } from "react";
import { UnitComparison, ComparisonSkeleton } from "./unit-comparison";

export const metadata: Metadata = { title: "Polling unit comparison" };

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UnitComparison id={id} />;
}

export default function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <Suspense fallback={<ComparisonSkeleton />}>
        <Resolved params={params} />
      </Suspense>
    </div>
  );
}
