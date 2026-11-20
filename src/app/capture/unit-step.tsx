"use client";

import { useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { ActionBar } from "@/components/action-bar";
import { SampleTag } from "@/components/demo-band";
import { UnitSearch } from "@/components/units/unit-search";
import { SYNTHETIC_UNITS, findPollingUnit } from "@/lib/seed/registry";

export function UnitStep({
  initialUnitId,
  onConfirm,
}: {
  initialUnitId: string | null;
  onConfirm: (unitId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(initialUnitId);
  const searchRef = useRef<HTMLInputElement>(null);
  const chosen = selected ? findPollingUnit(selected) : undefined;

  return (
    <section aria-labelledby="unit-h1">
      <h1 id="unit-h1" className="text-xl md:text-2xl">
        Which polling unit?
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 1 of 3</p>
      <p className="mt-3">Choose the polling unit where the result sheet is posted.</p>
      <p className="mt-3 flex items-start gap-2 text-sm">
        <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
        <span>Polling unit list saved on this device ({SYNTHETIC_UNITS.length} sample units). Works without network.</span>
      </p>

      <UnitSearch
        scope="capture"
        searchRef={searchRef}
        renderResults={(results, query, listId) => (
          <fieldset className="mt-4">
            <legend className="font-bold">Polling units</legend>
            {results.length === 0 ? (
              <p className="mt-3 rounded-md bg-sunken p-4">
                No polling unit matches “{query}”. Check the code on the result sheet, or browse by place.
              </p>
            ) : (
              <ul id={listId} className="slip mt-3">
                {results.map((u) => (
                  <li key={u.id}>
                    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3 has-[:checked]:bg-primary-tint">
                      <input
                        type="radio"
                        name="polling-unit"
                        value={u.id}
                        checked={selected === u.id}
                        onChange={() => setSelected(u.id)}
                        className="mt-1 size-5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block font-mono font-semibold">{u.code}</span>
                        <span className="block">
                          {u.name} {u.synthetic ? <SampleTag /> : null}
                        </span>
                        <span className="block text-sm text-ink-muted">
                          {u.ward} · {u.lga} · {u.state}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
      />

      {chosen ? (
        <ActionBar
          note={
            <div aria-live="polite">
              <p className="text-sm text-ink-muted">You chose:</p>
              <p className="font-mono text-lg font-semibold">{chosen.code}</p>
              <p>
                {chosen.name} {chosen.synthetic ? <SampleTag /> : null}
              </p>
              <p className="text-sm text-ink-muted">
                {chosen.ward} · {chosen.lga} · {chosen.state}
              </p>
            </div>
          }
        >
          <button type="button" className="btn btn-primary w-full" onClick={() => onConfirm(chosen.id)}>
            Yes, this is the polling unit
          </button>
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={() => {
              setSelected(null);
              searchRef.current?.focus();
            }}
          >
            Choose a different unit
          </button>
        </ActionBar>
      ) : (
        <div aria-hidden className="h-8" />
      )}
    </section>
  );
}

