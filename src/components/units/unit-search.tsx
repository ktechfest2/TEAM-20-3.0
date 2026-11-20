"use client";

import { useDeferredValue, useId, useMemo, useState, type ReactNode, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import type { PollingUnit } from "@/lib/contracts";
import { POLLING_UNITS, searchPollingUnits } from "@/lib/seed/registry";

const uniq = (xs: string[]) => [...new Set(xs)].sort();

/**
 * Shared polling-unit finder: code/name search plus State → LGA → Ward browse, over the registry
 * bundled with the app (works offline). Callers render the results (radios in capture, links in
 * the public finder) so both screens use the same search and filters.
 */
export function UnitSearch({
  searchRef,
  renderResults,
}: {
  searchRef?: Ref<HTMLInputElement>;
  renderResults: (results: PollingUnit[], query: string, listId: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [ward, setWard] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const filterSummary = [state, lga, ward].filter(Boolean).join(" › ");
  const deferred = useDeferredValue(query);
  const ids = { search: useId(), hint: useId(), list: useId() };

  const states = uniq(POLLING_UNITS.map((u) => u.state));
  const lgas = uniq(POLLING_UNITS.filter((u) => u.state === state).map((u) => u.lga));
  const wards = uniq(POLLING_UNITS.filter((u) => u.state === state && u.lga === lga).map((u) => u.ward));

  const results = useMemo(
    () =>
      searchPollingUnits(deferred, 50).filter(
        (u) => (!state || u.state === state) && (!lga || u.lga === lga) && (!ward || u.ward === ward),
      ),
    [deferred, state, lga, ward],
  );

  return (
    <>
      <div className="mt-6">
        <label htmlFor={ids.search} className="block font-bold">
          Search by polling unit code or name
        </label>
        <p id={ids.hint} className="text-sm text-ink-muted">
          Example: <span className="font-mono">DEMO.00.00.012</span>
        </p>
        <input
          ref={searchRef}
          id={ids.search}
          type="search"
          inputMode="search"
          autoComplete="off"
          aria-describedby={ids.hint}
          aria-controls={ids.list}
          className="field mt-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Browse sits in a closed disclosure so results follow the search box directly. */}
      <details
        className="group mt-3 rounded-md border border-rule bg-surface"
        open={browseOpen}
        onToggle={(e) => setBrowseOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-primary">Or browse by place</span>
            {filterSummary ? (
              <span className="block text-ink-muted">Showing: {filterSummary}</span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            size={20}
            className="shrink-0 text-primary transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-3 px-4 pb-4">
        <Select
          label="State"
          value={state}
          options={states}
          onChange={(v) => {
            setState(v);
            setLga("");
            setWard("");
          }}
        />
        <Select
          label="LGA"
          value={lga}
          options={lgas}
          disabledHint={!state ? "Choose a state first" : undefined}
          onChange={(v) => {
            setLga(v);
            setWard("");
          }}
        />
        <Select
          label="Ward"
          value={ward}
          options={wards}
          disabledHint={!lga ? "Choose an LGA first" : undefined}
          onChange={setWard}
        />
        </div>
      </details>

      <p className="sr-only" aria-live="polite">
        {results.length} polling units found
      </p>
      {renderResults(results, query, ids.list)}
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  disabledHint,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabledHint?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold">
        {label}
      </label>
      <select
        id={id}
        className="field mt-1"
        value={value}
        disabled={Boolean(disabledHint)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{disabledHint ?? `Any ${label}`}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
