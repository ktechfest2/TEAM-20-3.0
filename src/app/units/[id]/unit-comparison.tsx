"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleMinus, Copy, TriangleAlert, WifiOff } from "lucide-react";
import { UnitVerification, ReferenceView, type FieldDifference } from "@/lib/contracts/verification";
import { z } from "zod";
import { DemoTag } from "@/components/demo-band";
import { Stamp } from "@/components/stamp";
import { apiJson } from "@/components/client/api";
import { fmtTime, INDEPENDENCE_LINE, partyLabel, plural } from "@/components/client/format";
import { isReviewer, useSession } from "@/components/client/session";
import {
  DEMO_ELECTION_ID,
  higherLower,
  partyList,
  PROVENANCE,
  REFERENCE_TYPE_LINE,
  signed,
  STATUS_META,
} from "@/components/units/labels";
import { shortFingerprint } from "@/lib/offline/hash";
import { findPollingUnit } from "@/lib/seed/registry";

type State =
  | { status: "loading" }
  | { status: "ready"; v: UnitVerification; cachedAt: string | null; fetchedAt: string }
  | { status: "failed"; kind: "notFound" | "offline" | "error" };

const KEY = (id: string) => `polltrace:unit:${id}`;
function readCache(id: string) {
  try {
    const o = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as { v?: unknown; savedAt?: unknown } | null;
    const parsed = UnitVerification.safeParse(o?.v);
    return parsed.success && typeof o?.savedAt === "string" ? { v: parsed.data, savedAt: o.savedAt } : null;
  } catch {
    return null;
  }
}
function writeCache(id: string, v: UnitVerification) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify({ v, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full or blocked */
  }
}

export function ComparisonSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-4 pt-2">
      <p className="text-ink-muted">Loading the comparison…</p>
      <div className="h-40 rounded-md bg-sunken" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-10 rounded-md bg-sunken" />
      ))}
    </div>
  );
}

export function UnitComparison({ id }: { id: string }) {
  const unit = findPollingUnit(id);
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!unit) return;
    const ctrl = new AbortController();
    apiJson(`/api/units/${encodeURIComponent(id)}/verification?electionId=${DEMO_ELECTION_ID}`, UnitVerification, {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (r.ok) {
          writeCache(id, r.data);
          setState({ status: "ready", v: r.data, cachedAt: null, fetchedAt: new Date().toISOString() });
        } else if (r.kind === "http" && r.status === 404) setState({ status: "failed", kind: "notFound" });
        else if (r.kind === "network") {
          const c = readCache(id);
          setState(
            c
              ? { status: "ready", v: c.v, cachedAt: c.savedAt, fetchedAt: c.savedAt }
              : { status: "failed", kind: "offline" },
          );
        } else setState({ status: "failed", kind: "error" });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [id, unit, nonce]);

  if (!unit || (state.status === "failed" && state.kind === "notFound")) {
    return (
      <section className="mx-auto max-w-xl pt-4">
        <h1 className="text-xl">We could not find this polling unit</h1>
        <Link href="/units" className="btn btn-secondary mt-4 w-full no-underline">
          Find a polling unit
        </Link>
      </section>
    );
  }
  if (state.status === "loading") return <ComparisonSkeleton />;
  if (state.status === "failed") {
    return (
      <section className="mx-auto max-w-xl pt-4">
        <h1 className="font-mono text-xl">{unit.code}</h1>
        <p className="mt-4">
          {state.kind === "offline"
            ? "Connect to the internet to see this comparison."
            : "This comparison did not load."}
        </p>
        <button
          type="button"
          className="btn btn-secondary mt-4 w-full"
          onClick={() => {
            setState({ status: "loading" });
            setNonce((n) => n + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }
  return <Comparison v={state.v} cachedAt={state.cachedAt} fetchedAt={state.fetchedAt} unit={unit} />;
}

function Comparison({
  v,
  cachedAt,
  fetchedAt,
  unit,
}: {
  v: UnitVerification;
  cachedAt: string | null;
  fetchedAt: string;
  unit: NonNullable<ReturnType<typeof findPollingUnit>>;
}) {
  const session = useSession();
  const reviewer = isReviewer(session);
  const meta = STATUS_META[v.status];
  const nonZero = v.differences.filter((d) => d.referenceMinusWitness !== null && d.referenceMinusWitness !== 0);
  const parties = partyList(
    v.status === "CONFLICTING_EVIDENCE" ? v.conflictingParties : nonZero.map((d) => d.partyCode),
  );
  const confirmedDifference = v.status === "REFERENCE_DISCREPANCY" && !v.differenceUnconfirmed;
  const showKey = nonZero.length > 0 && (v.status === "REFERENCE_DISCREPANCY" || v.differenceUnconfirmed);
  const allegationOpen =
    v.status === "REFERENCE_DISCREPANCY" ||
    v.status === "CONFLICTING_EVIDENCE" ||
    (v.differenceUnconfirmed && nonZero.length > 0);
  const means =
    v.status === "INCONCLUSIVE"
      ? v.reasons[0]
      : meta.means({ distinct: v.distinctOriginals, independent: v.independentSources, parties });
  const copies = v.members.filter((m) => m.duplicateOf !== null).length;
  const noEvidence = v.status === "NO_EVIDENCE";

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="grid content-start gap-6 lg:col-span-7">
        <header>
          <p className="text-sm text-ink-muted">
            {unit.state} › {unit.lga} › {unit.ward}
          </p>
          <h1 className="mt-1 font-mono text-xl md:text-2xl">{unit.code}</h1>
          <p className="mt-1">
            {unit.name} {unit.synthetic || v.synthetic ? <DemoTag /> : null}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {v.formType ? `Form type compared: ${v.formType}` : "Form type: not known yet"}
          </p>
        </header>

        {cachedAt ? (
          <p role="status" className="flex items-start gap-3 rounded-md bg-sunken p-4">
            <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>
              You are offline. Showing the comparison saved on this device, last updated{" "}
              <span className="font-mono">{fmtTime(cachedAt)}</span>.
            </span>
          </p>
        ) : null}

        <section aria-labelledby="status-h" className="slip">
          <div className="grid gap-3 px-4 py-4">
            <h2 id="status-h" className="sr-only">
              Comparison status
            </h2>
            <div>
              <Stamp label={meta.stamp} icon={meta.icon} tone={meta.tone} />
            </div>
            <p className="text-lg font-bold">{v.reasons[0]}</p>
            {/* Key figure sits inside the status slip so it is above the fold at 360px. */}
            {showKey
              ? nonZero.map((d) => (
                  <div key={d.partyCode} className="grid gap-1">
                    <p className="font-mono text-figure font-semibold">{signed(d.referenceMinusWitness ?? 0)}</p>
                    <p>
                      {partyLabel(d.partyCode)}: the reference is {Math.abs(d.referenceMinusWitness ?? 0)} votes{" "}
                      {(d.referenceMinusWitness ?? 0) > 0 ? "higher" : "lower"} than the reviewed witness figure.
                      {v.differenceUnconfirmed ? " This difference is not confirmed." : ""}
                    </p>
                  </div>
                ))
              : null}
          </div>
          <dl className="grid gap-3 px-4 py-4">
            {noEvidence ? null : (
              <div>
                <dt className="font-bold">What this means</dt>
                <dd>{means}</dd>
              </div>
            )}
            <div>
              <dt className="font-bold">What this does not mean</dt>
              <dd>{meta.doesNotMean}</dd>
            </div>
          </dl>
          {v.reasons.length > 1 ? (
            <div className="px-4 py-3">
              <details className="group lg:hidden">
                <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">
                  More detail
                </summary>
                <ReasonList reasons={v.reasons.slice(1)} />
              </details>
              <div className="hidden lg:block">
                <p className="font-bold">More detail</p>
                <ReasonList reasons={v.reasons.slice(1)} />
              </div>
            </div>
          ) : null}
        </section>

        <p className="-mt-3 text-sm text-ink-muted">
          Comparison as of <span className="font-mono text-ink">{fmtTime(fetchedAt)}</span>
        </p>

        {noEvidence && !reviewer ? (
          <p>
            Have a photo of this result sheet?{" "}
            <Link href="/capture" className="inline-flex min-h-11 items-center font-bold text-primary">
              Capture it
            </Link>
          </p>
        ) : null}

        {noEvidence ? null : (
          <>
            <dl className="divide-y divide-rule rounded-md bg-sunken px-4">
              <Count label="Accepted photos counted" n={v.distinctOriginals} />
              <Count label="Independent sources (reviewer judged)" n={v.independentSources} />
              <Count label="Exact copies not counted" n={copies} />
            </dl>
            <ComparisonTable v={v} confirmedDifference={confirmedDifference} reviewer={reviewer} />
          </>
        )}

        <NoAllegation open={allegationOpen} />
      </div>

      <div className="grid content-start gap-8 lg:col-span-5">
        {v.reference ? (
          <ReferenceSlip reference={v.reference} tools={reviewer ? <ReviewerTools unitId={unit.id} /> : null} />
        ) : null}
        {noEvidence ? null : <Members v={v} reviewer={reviewer} />}
        {reviewer && !v.reference ? (
          <section aria-label="Reviewer tools" className="rounded-md bg-sunken p-4">
            <ReviewerTools unitId={unit.id} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  return (
    <ul className="mt-1 grid list-disc gap-1 pl-5">
      {reasons.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt>{label}</dt>
      <dd className="font-mono text-lg font-semibold">{n}</dd>
    </div>
  );
}

function ComparisonTable({
  v,
  confirmedDifference,
  reviewer,
}: {
  v: UnitVerification;
  confirmedDifference: boolean;
  reviewer: boolean;
}) {
  if (!v.witnessFigures) {
    return <p className="rounded-md bg-sunken p-4">There are no agreed witness figures to compare yet.</p>;
  }
  const witness = v.witnessFigures;
  const hasRef = v.reference !== null;
  const rows: FieldDifference[] = hasRef
    ? v.differences
    : Object.keys(witness).map((p) => ({
        partyCode: p,
        witness: witness[p],
        reference: null,
        referenceMinusWitness: null,
      }));

  return (
    <div>
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="pb-2 text-left">
          <span className="flex flex-wrap items-center gap-2 font-bold">
            {hasRef ? "Witness figures compared with the reference record" : "Reviewed witness figures"}
            {v.synthetic ? <DemoTag /> : null}
          </span>
          {hasRef ? <span className="block text-sm">Difference = reference minus witness</span> : null}
        </caption>
        <thead>
          <tr className="border-b-2 border-rule text-sm">
            <th scope="col" className="w-[26%] py-2 pr-2">
              Party
            </th>
            <th scope="col" className="py-2 pr-2 text-right">
              <span aria-hidden className="sm:hidden">
                Witness
              </span>
              <span className="sr-only sm:not-sr-only">Witness (reviewed)</span>
            </th>
            {hasRef ? (
              <>
                <th scope="col" className="py-2 pr-2 text-right">
                  <span aria-hidden className="sm:hidden">
                    Ref.
                  </span>
                  <span className="sr-only sm:not-sr-only">Reference</span>
                </th>
                <th scope="col" className="w-[34%] py-2 text-right">
                  Difference
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const diff = d.referenceMinusWitness;
            const amber = confirmedDifference && diff !== null && diff !== 0;
            const conflicting = v.conflictingParties.includes(d.partyCode);
            return (
              <tr
                key={d.partyCode}
                className={amber ? "border-2 border-caution bg-caution-tint" : "border-b border-rule"}
              >
                <th scope="row" className="py-3 pr-2 pl-1 align-top font-normal">
                  {partyLabel(d.partyCode)}
                  {reviewer ? <span className="block font-mono text-xs text-ink-muted">{d.partyCode}</span> : null}
                </th>
                <td className="py-3 pr-2 text-right align-top font-mono">
                  {d.witness !== null ? (
                    d.witness
                  ) : conflicting ? (
                    <span className="inline-flex items-center gap-1 font-sans">
                      <TriangleAlert aria-hidden size={16} className="text-caution" />
                      Disagree
                    </span>
                  ) : (
                    <span className="font-sans">Not known</span>
                  )}
                </td>
                {hasRef ? (
                  <>
                    <td className="py-3 pr-2 text-right align-top font-mono">
                      {d.reference ?? <span className="font-sans">Not known</span>}
                    </td>
                    <td className="py-3 pr-1 text-right align-top">
                      <DifferenceCell
                        diff={diff}
                        amber={amber}
                        unconfirmed={v.differenceUnconfirmed}
                        conflicting={conflicting}
                      />
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasRef ? (
        <p className="mt-2 text-sm">
          No reference record for this polling unit. PollTrace does not say whether these figures match anything else.
        </p>
      ) : null}
    </div>
  );
}

function DifferenceCell({
  diff,
  amber,
  unconfirmed,
  conflicting,
}: {
  diff: number | null;
  amber: boolean;
  unconfirmed: boolean;
  conflicting: boolean;
}): ReactNode {
  if (diff === null) {
    return (
      <span>
        Not known
        <span className="block text-sm">{conflicting ? "Witnesses disagree" : "Not readable on every photo"}</span>
      </span>
    );
  }
  if (diff === 0) {
    return (
      <span className="font-mono">
        0 <span className="font-sans text-xs">same</span>
      </span>
    );
  }
  if (amber) {
    return (
      <span className="grid justify-items-end gap-0.5">
        <span className="inline-flex items-center gap-1 font-mono font-bold">
          <TriangleAlert aria-hidden size={18} className="text-caution" />
          {signed(diff)}
        </span>
        <span className="text-sm">{higherLower(diff)}</span>
      </span>
    );
  }
  return (
    <span className="grid justify-items-end gap-1">
      <span className="font-mono font-bold">{signed(diff)}</span>
      {unconfirmed ? <Stamp small label="Not confirmed" icon={CircleMinus} tone="outline" /> : null}
      <span className="text-sm">
        {higherLower(diff)}
        {unconfirmed ? " (not confirmed)" : ""}
      </span>
    </span>
  );
}

const ALLEGATION_COPY = [
  "PollTrace compares records. It does not decide which one is correct.",
  "A difference can come from a misread number, a photo of a different sheet, a later correction, or an entry mistake in either record.",
  "Only INEC declares official results. This comparison is not an official result.",
  "To look into it, compare the sources listed below.",
];

function NoAllegation({ open }: { open: boolean }) {
  const body = (
    <ul className="mt-2 grid list-disc gap-2 pl-5">
      {ALLEGATION_COPY.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
  if (open) {
    return (
      <section aria-labelledby="allegation-h" className="rounded-md bg-sunken p-4">
        <h2 id="allegation-h" className="text-xl">
          Why no allegation is made
        </h2>
        {body}
      </section>
    );
  }
  return (
    <details className="rounded-md bg-sunken px-4 py-2">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">
        Why PollTrace never makes allegations
      </summary>
      {body}
    </details>
  );
}

function ReferenceSlip({
  reference: r,
  tools,
}: {
  reference: NonNullable<UnitVerification["reference"]>;
  tools: ReactNode;
}) {
  const p = PROVENANCE[r.reviewState];
  return (
    <section aria-labelledby="ref-h" className="slip">
      <div className="px-4 py-3">
        <h2 id="ref-h" className="font-sans text-lg font-bold">
          Reference record, version <span className="font-mono">{r.version}</span>
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          {r.sourceType === "SYNTHETIC_DEMO" ? (
            <strong>{REFERENCE_TYPE_LINE[r.sourceType]}</strong>
          ) : (
            REFERENCE_TYPE_LINE[r.sourceType]
          )}
          {r.synthetic ? <DemoTag /> : null}
        </p>
      </div>
      <dl className="grid gap-3 px-4 py-3">
        <div>
          <dt className="slip-label">Source description</dt>
          <dd>“{r.sourceDescription}”</dd>
        </div>
        {r.sourceUrl ? (
          <div>
            <dt className="slip-label">Source link (not opened by PollTrace)</dt>
            <dd className="font-mono break-words">{r.sourceUrl}</dd>
          </div>
        ) : null}
      </dl>
      <div className="grid gap-2 px-4 py-3">
        <div>
          <Stamp label={p.stamp} icon={p.icon} tone={p.tone} />
        </div>
        <p className="text-sm">{p.text}</p>
      </div>
      {tools ? <div className="px-4 py-3">{tools}</div> : null}
    </section>
  );
}

function Members({ v, reviewer }: { v: UnitVerification; reviewer: boolean }) {
  const indexOf = new Map(v.members.map((m, i) => [m.evidenceId, i + 1]));
  return (
    <section aria-labelledby="members-h">
      <h2 id="members-h" className="text-xl">
        Photos considered
      </h2>
      <p className="mt-1 text-sm">
        Photos are counted once each. Exact copies and photos without accepted, confirmed figures are not counted.
        Matching photos are not independent witnesses.
      </p>
      {v.members.length === 0 ? (
        <p className="mt-2">No photos yet.</p>
      ) : (
        <MemberList v={v} reviewer={reviewer} indexOf={indexOf} />
      )}
    </section>
  );
}

const INDEPENDENCE_ALL: Record<UnitVerification["members"][number]["independence"], string> = {
  REVIEWER_CONFIRMED: "all judged independent by a reviewer",
  UNVERIFIED: "independence not assessed",
  DISPUTED: "all judged not independent by a reviewer",
};

/**
 * When every photo is counted with the same independence, one summary line says so and the
 * individual rows sit behind "Show each photo"; otherwise every row is listed.
 */
function MemberList({
  v,
  reviewer,
  indexOf,
}: {
  v: UnitVerification;
  reviewer: boolean;
  indexOf: Map<string, number>;
}) {
  const allSame =
    v.members.length > 1 &&
    v.members.every((m) => m.eligible && !m.duplicateOf && m.independence === v.members[0].independence);
  const rows = <MemberRows v={v} reviewer={reviewer} indexOf={indexOf} />;
  if (!allSame) return rows;
  const n = v.members.length;
  return (
    <div className="mt-3 grid gap-2">
      <p className="flex flex-wrap items-center gap-2">
        <Stamp small label="Counted" icon={CircleCheck} tone="tealOutline" />
        <span>
          <span className="font-mono">{n}</span> photos counted · {INDEPENDENCE_ALL[v.members[0].independence]}
        </span>
      </p>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">Show each photo</summary>
        {rows}
      </details>
    </div>
  );
}

function MemberRows({
  v,
  reviewer,
  indexOf,
}: {
  v: UnitVerification;
  reviewer: boolean;
  indexOf: Map<string, number>;
}) {
  return (
    <ol className="slip mt-3">
      {v.members.map((m, i) => (
        <li key={m.evidenceId} className="grid gap-2 px-4 py-3">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-bold">Photo {i + 1}</span>
            <span className="font-mono text-sm">{shortFingerprint(m.sha256)}</span>
          </p>
          <p className="text-sm">
            {m.revisionNumber !== null ? (
              <>
                Version <span className="font-mono">{m.revisionNumber}</span> of figures
              </>
            ) : (
              "No confirmed figures"
            )}{" "}
            · {INDEPENDENCE_LINE[m.independence]}
          </p>
          <div>
            {m.duplicateOf ? (
              <Stamp
                small
                label={`Exact copy of photo ${indexOf.get(m.duplicateOf) ?? "?"} — not counted`}
                icon={Copy}
                tone="attention"
              />
            ) : m.eligible ? (
              <Stamp small label="Counted" icon={CircleCheck} tone="tealOutline" />
            ) : (
              <Stamp small label="Not counted" icon={CircleMinus} tone="outline" />
            )}
          </div>
          {!m.eligible && m.excludedReason && !m.duplicateOf ? <p className="text-sm">{m.excludedReason}</p> : null}
          {reviewer ? (
            <Link
              href={`/evidence/${m.evidenceId}`}
              className="inline-flex min-h-11 items-center font-bold text-primary"
            >
              Open ProofTrail<span className="sr-only"> for photo {i + 1}</span>
            </Link>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ReviewerTools({ unitId }: { unitId: string }) {
  const [newest, setNewest] = useState<{ total: number; version: number; state: string } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    apiJson(`/api/units/${unitId}/references?electionId=${DEMO_ELECTION_ID}`, z.array(ReferenceView), {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok || r.data.length === 0) return;
        const latest = [...r.data].sort((a, b) => b.version - a.version)[0];
        const last = [...latest.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
        setNewest({
          total: r.data.length,
          version: latest.version,
          state: !last
            ? "waiting for a second reviewer"
            : last.decision === "SOURCE_CONFIRMED"
              ? "source confirmed by a second reviewer"
              : "source not accepted",
        });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [unitId]);
  return (
    <div className="grid gap-2">
      <Link href={`/units/${unitId}/references`} className="btn btn-secondary w-full no-underline">
        Reference records for this unit
      </Link>
      {newest ? (
        <p className="text-sm">
          Newest version <span className="font-mono">{newest.version}</span>: {newest.state}.{" "}
          <span className="font-mono">{newest.total}</span> {plural(newest.total, "version")} kept.
        </p>
      ) : null}
    </div>
  );
}
