"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DemoTag } from "@/components/demo-band";
import { UnitSearch } from "@/components/units/unit-search";

/** Public finder: the shared capture search, with results as links to each comparison page. */
export function UnitFinder() {
  return (
    <UnitSearch
      renderResults={(results, query, listId) => (
        <section aria-label="Polling units" className="mt-6">
          {results.length === 0 ? (
            <p className="rounded-md bg-sunken p-4">
              No polling unit matches “{query}”. Check the code, or browse by place.
            </p>
          ) : (
            <ul id={listId} className="slip">
              {results.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/units/${u.id}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-primary-tint"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-semibold">{u.code}</span>
                      <span className="block">
                        {u.name} {u.synthetic ? <DemoTag /> : null}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        {u.ward} · {u.lga} · {u.state}
                      </span>
                    </span>
                    <ChevronRight aria-hidden size={20} className="shrink-0 text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    />
  );
}
