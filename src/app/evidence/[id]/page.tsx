import type { Metadata } from "next";
import { Suspense } from "react";
import { EvidenceScreen, EvidenceSkeleton } from "./evidence-screen";

export const metadata: Metadata = { title: "ProofTrail" };

async function Resolved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvidenceScreen id={id} />;
}

export default function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <Suspense fallback={<EvidenceSkeleton />}>
        <Resolved params={params} />
      </Suspense>
    </div>
  );
}
