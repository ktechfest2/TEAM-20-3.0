import type { Metadata } from "next";
import Link from "next/link";
import { UnitFinder } from "./unit-finder";

export const metadata: Metadata = { title: "Find a polling unit" };

export default function UnitsPage() {
  return (
    <div className="mx-auto w-full max-w-[40rem] px-4 pt-6 pb-12">
      <h1 className="text-xl md:text-2xl">Find a polling unit</h1>
      <p className="mt-2">Open a polling unit to see how its reviewed records compare.</p>
      <UnitFinder />
      <footer className="mt-10 border-t border-rule pt-4">
        <Link href="/reviewer" className="inline-flex min-h-11 items-center text-sm text-ink-muted">
          Reviewer sign-in
        </Link>
      </footer>
    </div>
  );
}
