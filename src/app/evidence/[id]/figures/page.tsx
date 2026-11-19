import type { Metadata } from "next";
import { Suspense } from "react";
import { FiguresFlow, FiguresSkeleton } from "./figures-flow";

export const metadata: Metadata = { title: "Enter the figures" };

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FiguresFlow id={id} />;
}

export default function FiguresPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-2 pb-16">
      <Suspense fallback={<FiguresSkeleton />}>
        <Resolved params={params} />
      </Suspense>
    </div>
  );
}
