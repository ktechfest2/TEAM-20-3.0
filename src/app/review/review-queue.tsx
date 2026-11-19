"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, CircleDashed, Copy, FileQuestion, User, WifiOff } from "lucide-react";
import { ReviewQueueResponse, type ReviewQueueItem } from "@/lib/contracts/trace";
import { DemoTag } from "@/components/demo-band";
import { Stamp } from "@/components/stamp";
import { apiJson } from "@/components/client/api";
import { DECISION_WORD, fmtTime, plural, SOURCE_SHORT } from "@/components/client/format";
import { useOnline } from "@/lib/offline/use-network";

type State =
  | { status: "loading" }
  | { status: "ready"; items: ReviewQueueItem[] }
  | { status: "failed"; kind: "forbidden" | "offline" | "error" };

const PAGE = 30;

export function ReviewQueue() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const online = useOnline();

  useEffect(() => {
    const ctrl = new AbortController();
    apiJson("/api/review/queue", ReviewQueueResponse, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) setState({ status: "ready", items: r.data.items });
        else if (r.kind === "http" && (r.status === 401 || r.status === 403)) setState({ status: "failed", kind: "forbidden" });
        else if (r.kind === "network") setState({ status: "failed", kind: "offline" });
        else setState({ status: "failed", kind: "error" });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [nonce]);

  const retry = () => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  };

  if (state.status === "failed" && state.kind === "forbidden") {
    return (
      <section className="mx-auto max-w-xl">
        <h1 className="text-xl md:text-2xl">Evidence to review</h1>
        <h2 className="mt-6 text-xl">This page is for reviewers</h2>
        <p className="mt-2">Sign in with a reviewer account to see evidence waiting for review.</p>
        <Link href="/reviewer?next=/review" className="btn btn-primary mt-4 w-full no-underline md:w-auto">
          Reviewer sign-in
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-h1">
      <h1 id="review-h1" className="text-xl md:text-2xl">
        Evidence to review
      </h1>

      {state.status === "loading" ? (
        <div aria-busy="true" className="mt-4 grid gap-3">
          <p className="text-ink-muted">Loading the review list…</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-md bg-sunken lg:h-14" />
          ))}
        </div>
      ) : state.status === "failed" ? (
        <div className="mt-4 max-w-xl">
          {state.kind === "offline" || !online ? (
            <p className="flex items-start gap-3 rounded-md bg-sunken p-4">
              <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
              <span>You are offline. Reviewing needs a connection. The list will load when you reconnect.</span>
            </p>
          ) : (
            <p role="alert">The review list did not load.</p>
          )}
          <button type="button" className="btn btn-secondary mt-3 w-full md:w-auto" onClick={retry}>
            Try again
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="mt-6 max-w-xl">
          <h2 className="text-xl">Nothing waiting for review</h2>
          <p className="mt-2">
            New photos appear here once the server has received them and the sender has confirmed the figures, or
            straight away if no figures are entered yet.
          </p>
          <Link href="/units" className="mt-3 inline-flex min-h-11 items-center font-bold text-primary">
            Find a polling unit
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2">
            Oldest first. <span className="font-mono">{state.items.length}</span> waiting.
          </p>
          <p className="text-sm text-ink-muted">
            Reviews are kept permanently. A later decision can supersede an earlier one but not erase it.
          </p>

          {/* Phones and tablets: one card per item. */}
          <ul className="mt-4 grid gap-3 lg:hidden">
            {state.items.slice(0, shown).map((it) => (
              <li key={it.id} className="grid gap-2 rounded-md border-2 border-rule bg-surface p-4">
                <UnitCell item={it} />
                <p className="font-mono text-sm">Received {fmtTime(it.receivedAt)}</p>
                <div>
                  <FiguresCell item={it} />
                </div>
                <CopiesCell item={it} />
                <DecisionsCell item={it} />
                <p className="text-sm">{SOURCE_SHORT[it.sourceType]}</p>
                <ActionCell item={it} />
              </li>
            ))}
          </ul>

          {/* Wide screens: a fixed-order table. Only the Action cell links. */}
          <table className="mt-4 hidden w-full border-collapse text-left lg:table">
            <caption className="sr-only">Evidence waiting for review, oldest first</caption>
            <thead>
              <tr className="border-b-2 border-rule text-sm">
                <th scope="col" className="py-2 pr-3">Polling unit</th>
                <th scope="col" className="py-2 pr-3">Received</th>
                <th scope="col" className="py-2 pr-3">Figures</th>
                <th scope="col" className="py-2 pr-3">Copies</th>
                <th scope="col" className="py-2 pr-3">Earlier decisions</th>
                <th scope="col" className="py-2 pr-3">Source (own statement)</th>
                <th scope="col" className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {state.items.slice(0, shown).map((it) => (
                <tr key={it.id} className="border-b border-rule align-top">
                  <td className="py-3 pr-3">
                    <UnitCell item={it} />
                  </td>
                  <td className="py-3 pr-3 font-mono text-sm">{fmtTime(it.receivedAt)}</td>
                  <td className="py-3 pr-3">
                    <FiguresCell item={it} />
                  </td>
                  <td className="py-3 pr-3">
                    <CopiesCell item={it} fallback="None" />
                  </td>
                  <td className="py-3 pr-3">
                    <DecisionsCell item={it} fallback="None" />
                  </td>
                  <td className="py-3 pr-3 text-sm">
                    {it.sourceType === "OBSERVER_PHOTO" ? "Observer or party agent" : "Voter or witness"}
                  </td>
                  <td className="py-3">
                    <ActionCell item={it} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.items.length > shown ? (
            <button type="button" className="btn btn-secondary mt-4" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function UnitCell({ item }: { item: ReviewQueueItem }) {
  return (
    <div>
      <p className="font-mono font-semibold">{item.pollingUnitCode}</p>
      <p>
        {item.pollingUnitName} {item.synthetic ? <DemoTag /> : null}
      </p>
    </div>
  );
}

function FiguresCell({ item }: { item: ReviewQueueItem }) {
  const r = item.latestRevision;
  if (!r) return <Stamp small label="No figures yet" icon={FileQuestion} tone="outline" />;
  if (!r.humanConfirmed) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Stamp small label="Figures not confirmed" icon={CircleDashed} tone="local" />
        {r.origin === "DEMO_FIXTURE" ? (
          <span className="inline-flex items-center gap-1 text-sm">
            <DemoTag /> demo figures
          </span>
        ) : null}
      </span>
    );
  }
  return <Stamp small label="Figures confirmed by sender" icon={CircleCheck} tone="progress" />;
}

function CopiesCell({ item, fallback }: { item: ReviewQueueItem; fallback?: string }) {
  const n = item.exactDuplicateCount;
  if (n === 0) return fallback ? <span className="text-sm">{fallback}</span> : null;
  return (
    <p className="flex items-center gap-1 text-sm text-caution">
      <Copy aria-hidden size={18} />
      Exact copy of {n} other {plural(n, "submission")}
    </p>
  );
}

function DecisionsCell({ item, fallback }: { item: ReviewQueueItem; fallback?: string }) {
  if (item.reviewCount === 0) return fallback ? <span className="text-sm">{fallback}</span> : null;
  return (
    <p className="text-sm">
      <span className="font-mono">{item.reviewCount}</span> earlier {plural(item.reviewCount, "decision")}
      {item.lastDecision ? ` · last: ${DECISION_WORD[item.lastDecision]}` : ""}
    </p>
  );
}

function ActionCell({ item }: { item: ReviewQueueItem }) {
  if (item.submittedByViewer) {
    return (
      <div className="grid justify-items-start gap-2">
        <Stamp small label="You sent this" icon={User} tone="outline" />
        <p className="text-sm">Another reviewer must review it.</p>
        <Link href={`/evidence/${item.id}`} className="btn btn-secondary no-underline">
          Open (view only)
        </Link>
      </div>
    );
  }
  return (
    <Link href={`/evidence/${item.id}#review`} className="btn btn-secondary whitespace-nowrap no-underline">
      Open and review<span className="sr-only"> {item.pollingUnitCode}</span>
    </Link>
  );
}
