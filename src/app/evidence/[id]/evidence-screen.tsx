"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CircleCheck, CloudOff, ExternalLink, TriangleAlert, WifiOff } from "lucide-react";
import type { EvidenceTrace, ResultRevisionView, TraceEvent } from "@/lib/contracts/trace";
import { DemoTag } from "@/components/demo-band";
import { Stamp } from "@/components/stamp";
import { DecisionStamp, DuplicateStamp, EvidenceStatusStamp, IntegrityStamp, OriginStamp } from "@/components/evidence/stamps";
import {
  ChangeList,
  diffRevisions,
  FIGURE_KEYS,
  figureLabel,
  figureValue,
  FiguresTable,
  Warnings,
  type FigureKey,
} from "@/components/evidence/figures";
import { OriginalPhoto } from "@/components/evidence/original-photo";
import { sheetCodeMismatch } from "@/components/evidence/pu-code";
import { latestRevisionOf, useTrace } from "@/components/evidence/use-trace";
import { fileLine, fmtTime, INDEPENDENCE_LINE, SOURCE_LONG } from "@/components/client/format";
import { isReviewer, useSession } from "@/components/client/session";
import { groupedHash, shortFingerprint } from "@/lib/offline/hash";
import { useOnline } from "@/lib/offline/use-network";
import { ReviewPanel } from "./review-panel";

export function EvidenceSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-6 lg:grid-cols-12">
      <p className="sr-only">Loading this record…</p>
      <div className="aspect-[3/4] rounded-lg bg-sunken lg:col-span-5" />
      <div className="grid content-start gap-4 lg:col-span-7">
        <div className="h-24 rounded-md bg-sunken" />
        <div className="h-40 rounded-md bg-sunken" />
        <div className="h-40 rounded-md bg-sunken" />
      </div>
    </div>
  );
}

function BackLink({ reviewer }: { reviewer: boolean }) {
  return (
    <Link
      href={reviewer ? "/review" : "/submissions"}
      className="inline-flex min-h-11 items-center gap-2 font-bold text-primary"
    >
      <ArrowLeft aria-hidden size={20} />
      {reviewer ? "Review list" : "Your submissions"}
    </Link>
  );
}

export function EvidenceScreen({ id }: { id: string }) {
  const { state, reload, retry } = useTrace(id);
  const session = useSession();
  const reviewerSession = isReviewer(session);
  const online = useOnline();

  useEffect(() => {
    // Hash targets (#figures, #review) exist only after the trace renders.
    if (state.status === "ready" && location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }, [state.status]);

  if (state.status === "loading") return <EvidenceSkeleton />;
  if (state.status === "failed") {
    return (
      <section className="mx-auto max-w-xl pt-4">
        {state.kind === "notFound" ? (
          <>
            <h1 className="text-xl">We could not find this record</h1>
            <p className="mt-2">It may be private, or the link may be wrong.</p>
            <Link href={reviewerSession ? "/review" : "/submissions"} className="btn btn-secondary mt-4 w-full no-underline">
              {reviewerSession ? "Back to review list" : "Back to your submissions"}
            </Link>
          </>
        ) : state.kind === "unauthenticated" ? (
          <>
            <h1 className="text-xl">Your session has ended</h1>
            <p className="mt-2">Open PollTrace on the phone that sent this photo, or sign in as a reviewer.</p>
            <Link href={`/reviewer?next=${encodeURIComponent(`/evidence/${id}`)}`} className="btn btn-secondary mt-4 w-full no-underline">
              Reviewer sign-in
            </Link>
          </>
        ) : state.kind === "offline" ? (
          <>
            <h1 className="text-xl">You are offline</h1>
            <p className="mt-2">Connect to the internet to view this record.</p>
            <button type="button" className="btn btn-secondary mt-4 w-full" onClick={retry}>
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl">This record did not load</h1>
            <button type="button" className="btn btn-secondary mt-4 w-full" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </section>
    );
  }

  const offlineCopy = state.cachedAt !== null || !online;
  return <Trace trace={state.trace} cachedAt={state.cachedAt} offline={offlineCopy} onChanged={reload} />;
}

function Trace({
  trace,
  cachedAt,
  offline,
  onChanged,
}: {
  trace: EvidenceTrace;
  cachedAt: string | null;
  offline: boolean;
  onChanged: () => void;
}) {
  const { evidence: e, permissions, viewer } = trace;
  const params = useSearchParams();
  const confirmedVersion = params.get("confirmed");
  const reviewer = viewer === "REVIEWER";
  const latest = latestRevisionOf(trace);
  const revisionsNewest = [...trace.revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  const reviewsNewest = [...trace.reviews].reverse();

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-12">
        <BackLink reviewer={reviewer} />
      </div>

      {/* Header and next step come first in DOM (reading order); the photo follows, sticky left column on wide screens. */}
      <div className="grid content-start gap-6 lg:col-span-7 lg:col-start-6 lg:row-start-2">
        <header>
          <h1 className="text-xl md:text-2xl">
            Result photo for <span className="font-mono">{e.pollingUnitCode}</span>
          </h1>
          <p className="mt-1">
            {e.pollingUnitName} {e.synthetic ? <DemoTag /> : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <EvidenceStatusStamp status={e.status} />
            {reviewer ? (
              <a href="#review" className="inline-flex min-h-11 items-center font-bold text-primary">
                Go to review panel
              </a>
            ) : null}
          </div>
        </header>

        {offline ? (
          <p role="status" className="flex items-start gap-3 rounded-md bg-sunken p-4">
            <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>
              {cachedAt ? (
                <>
                  You are offline. Showing the copy saved on this device, last updated{" "}
                  <span className="font-mono">{fmtTime(cachedAt)}</span>. Actions are paused until you reconnect.
                </>
              ) : (
                "You are offline. Actions are paused until you reconnect."
              )}
            </span>
          </p>
        ) : null}

        {viewer === "OWNER" ? (
          <NextStep trace={trace} latest={latest} offline={offline} confirmedVersion={confirmedVersion} />
        ) : null}
      </div>

      <section aria-label="Original photo" className="lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-2">
        <div className="lg:sticky lg:top-4">
          <OriginalPhoto
            src={trace.originalUrl}
            synthetic={e.synthetic}
            alt={`Original photo of the result sheet sent for ${e.pollingUnitCode}`}
            className="overflow-hidden rounded-lg border border-rule bg-sunken"
            imgClassName="w-full lg:max-h-[calc(100dvh-6rem)] lg:object-contain"
          />
          <p className="mt-2 text-sm text-ink-muted">Original photo, unchanged since upload.</p>
          <a
            href={trace.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 font-bold text-primary"
          >
            Open full size <ExternalLink aria-hidden size={18} />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </section>

      <div className="grid content-start gap-8 lg:col-span-7 lg:col-start-6 lg:row-start-3">
        <IntactSlip trace={trace} />

        <section id="figures" aria-labelledby="figures-h" className="scroll-mt-4">
          <h2 id="figures-h" className="text-xl">
            Figures
          </h2>
          {latest ? (
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <OriginStamp origin={latest.origin} />
              </div>
              <p className="text-sm">
                {latest.humanConfirmed
                  ? `Confirmed by ${latest.createdByViewer ? "you" : "the contributor"}, version ${latest.revisionNumber}, `
                  : "Not confirmed by a person yet. Not used in any comparison."}
                {latest.humanConfirmed ? <span className="font-mono">{fmtTime(latest.createdAt)}</span> : null}
              </p>
              <AiBasis latest={latest} revisions={trace.revisions} />
              {sheetCodeMismatch(latest.pollingUnitCodeOnSheet, e.pollingUnitCode) ? (
                <p className="flex items-start gap-2 rounded-md border-2 border-caution bg-caution-tint p-3">
                  <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
                  <span>
                    The sheet shows a different polling-unit code (
                    <span className="font-mono">{sheetCodeMismatch(latest.pollingUnitCodeOnSheet, e.pollingUnitCode)}</span>)
                    from the unit chosen (<span className="font-mono">{e.pollingUnitCode}</span>). The unit is not changed.
                  </span>
                </p>
              ) : null}
              <div className="slip px-4 py-2">
                <FiguresTable revision={latest} />
              </div>
              <Warnings warnings={latest.warnings} />
              {viewer === "OWNER" && permissions.canConfirm && latest.humanConfirmed ? (
                offline ? (
                  <p className="text-sm">
                    <button type="button" className="btn btn-secondary" disabled>
                      Correct the figures
                    </button>{" "}
                    Needs a connection
                  </p>
                ) : (
                  <Link
                    href={`/evidence/${e.id}/figures?step=enter`}
                    className="inline-flex min-h-11 items-center font-bold text-primary"
                  >
                    Correct the figures
                  </Link>
                )
              ) : null}
            </div>
          ) : (
            <p className="mt-2">
              No figures yet.
              {viewer === "OWNER" ? " Read the figures from the photo to continue." : null}
            </p>
          )}
        </section>

        {reviewer ? <ReviewPanel trace={trace} offline={offline} onRecorded={onChanged} /> : null}

        <Versions revisions={revisionsNewest} />

        <section aria-labelledby="reviews-h">
          <h2 id="reviews-h" className="text-xl">
            Review decisions
          </h2>
          {reviewsNewest.length === 0 ? (
            <p className="mt-2">No review yet.</p>
          ) : (
            <ol className="slip mt-3">
              {reviewsNewest.map((r, i) => (
                <li key={r.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <DecisionStamp decision={r.decision} />
                    {r.synthetic ? <DemoTag /> : null}
                  </div>
                  <p>Independence: {INDEPENDENCE_LINE[r.independenceStatus]}</p>
                  <blockquote className="border-l-0 italic">“{r.reason}”</blockquote>
                  <p className="text-sm text-ink-muted">
                    {r.byViewer ? "By you" : <>Reviewer <span className="font-mono">{r.reviewerRef}</span></>} ·{" "}
                    <span className="font-mono">{fmtTime(r.createdAt)}</span>
                  </p>
                  {i > 0 ? <p className="text-sm">Superseded by a later decision (kept on record)</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <Timeline events={trace.timeline} revisions={trace.revisions} />

        <p>
          <Link href={`/units/${e.pollingUnitId}`} className="btn btn-secondary w-full no-underline md:w-auto">
            See polling unit comparison
          </Link>
        </p>
      </div>
    </div>
  );
}

function NextStep({
  trace,
  latest,
  offline,
  confirmedVersion,
}: {
  trace: EvidenceTrace;
  latest: ResultRevisionView | null;
  offline: boolean;
  confirmedVersion: string | null;
}) {
  const { permissions, evidence: e } = trace;
  if (confirmedVersion && latest?.humanConfirmed && String(latest.revisionNumber) === confirmedVersion) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-md bg-primary-tint p-4 text-ink">
        <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-primary" />
        <p>
          Figures confirmed and saved as version <span className="font-mono">{latest.revisionNumber}</span>. Earlier
          versions are kept. A reviewer will look at this next.
        </p>
      </div>
    );
  }
  let text: string | null = null;
  let action: { label: string; href: string } | null = null;
  if (!latest && permissions.canExtract) {
    text = "Next: read the figures on the photo so they can be compared.";
    action = { label: "Read the figures", href: `/evidence/${e.id}/figures` };
  } else if (latest && !latest.humanConfirmed && permissions.canConfirm) {
    text =
      latest.origin === "REAL_VISION"
        ? "Next: check the AI’s suggested figures against the photo and confirm them."
        : "Next: check the figures against the photo and confirm them.";
    action = { label: "Check and confirm figures", href: `/evidence/${e.id}/figures?step=enter` };
  } else if (latest?.humanConfirmed && e.status === "PENDING_REVIEW") {
    text = "Figures confirmed. A reviewer will look at this next. You do not need to do anything.";
  }
  if (!text) return null;
  return (
    <div className="rounded-md bg-primary-tint p-4">
      <p>{text}</p>
      {action ? (
        offline ? (
          <div className="mt-3">
            <button type="button" className="btn btn-primary w-full md:w-auto" disabled>
              {action.label}
            </button>
            <p className="mt-1 text-sm">Needs a connection</p>
          </div>
        ) : (
          <Link href={action.href} className="btn btn-primary mt-3 w-full no-underline md:w-auto">
            {action.label}
          </Link>
        )
      ) : null}
    </div>
  );
}

function Row({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-4">
      <h3 className="text-lg font-bold">{question}</h3>
      {children}
    </div>
  );
}

function IntactSlip({ trace }: { trace: EvidenceTrace }) {
  const { evidence: e, integrity } = trace;
  const [copied, setCopied] = useState(false);
  const n = integrity.exactDuplicateCount;
  return (
    <section aria-labelledby="intact-h">
      <h2 id="intact-h" className="text-xl">
        Is this photo intact?
      </h2>
      <div className="slip mt-3">
        <Row question="Did the photo arrive unchanged?">
          <div>
            <IntegrityStamp matched={integrity.serverHashMatchedClient} />
          </div>
          {integrity.serverHashMatchedClient ? (
            <p>The server made its own SHA-256 fingerprint and it matches the one made on the phone.</p>
          ) : (
            <p>The server could not match the fingerprint. This photo is not used in comparisons.</p>
          )}
          <p className="font-mono">{shortFingerprint(e.sha256)}</p>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">
              Show full fingerprint
            </summary>
            <p className="font-mono break-words">{groupedHash(e.sha256)}</p>
            <button
              type="button"
              className="btn btn-secondary mt-2"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(e.sha256);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard blocked: the value is visible to copy by hand */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <span className="sr-only" aria-live="polite">
              {copied ? "Fingerprint copied" : ""}
            </span>
          </details>
          <p className="text-sm text-ink-muted">
            This shows the file was not changed after it left the phone. It does not show that the result sheet itself
            is genuine or correct.
          </p>
        </Row>
        <Row question="Is it an exact copy of another submission?">
          <div>
            <DuplicateStamp count={n} />
          </div>
          {n > 0 ? <p>Same fingerprint, same file. Copies are counted once, never as extra witnesses.</p> : null}
        </Row>
        <Row question="Who sent it?">
          <dl className="grid gap-2">
            <Pair label="Sent by">
              {SOURCE_LONG[e.sourceType]} <span className="text-sm text-ink-muted">their own statement, not checked</span>
            </Pair>
            <Pair label="Photo taken">
              {e.capturedAtClaimed ? (
                <>
                  <span className="font-mono">{fmtTime(e.capturedAtClaimed)}</span>{" "}
                  <span className="text-sm text-ink-muted">(phone clock — a claim, not checked)</span>
                </>
              ) : (
                "Not given"
              )}
            </Pair>
            <Pair label="Received by server">
              <span className="font-mono">{fmtTime(e.receivedAt)}</span>{" "}
              <span className="text-sm text-ink-muted">(server time)</span>
            </Pair>
            <Pair label="File">
              <span className="font-mono">{fileLine(e.mime, e.sizeBytes)}</span>
            </Pair>
            <Pair label="Stored">{e.storageMode === "LOCAL_DEV" ? "On this demo server" : "Private cloud storage"}</Pair>
          </dl>
        </Row>
      </div>
    </section>
  );
}

function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="slip-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Versions({ revisions }: { revisions: ResultRevisionView[] }) {
  const byNumber = new Map(revisions.map((r) => [r.revisionNumber, r]));
  return (
    <section aria-labelledby="versions-h">
      <h2 id="versions-h" className="text-xl">
        Versions of the figures
      </h2>
      <p className="mt-1 text-sm">
        Every version is kept. A correction adds a new version; it never changes an earlier one.
      </p>
      {revisions.length === 0 ? null : (
        <ol className="slip mt-3">
          {revisions.map((r) => {
            const baseNo = r.basedOnRevision ?? (r.revisionNumber > 1 ? r.revisionNumber - 1 : null);
            const base = baseNo ? byNumber.get(baseNo) : undefined;
            const changes = base ? diffRevisions(base, r) : [];
            const who =
              r.origin === "REAL_VISION"
                ? "AI model"
                : r.origin === "DEMO_FIXTURE"
                  ? "System"
                  : r.createdByViewer
                    ? "You"
                    : "Contributor";
            const baseIsAi = base?.origin === "REAL_VISION" && r.origin === "HUMAN_CORRECTION";
            return (
              <li key={r.id} id={`v${r.revisionNumber}`} className="grid scroll-mt-4 gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">Version {r.revisionNumber}</span>
                  <OriginStamp origin={r.origin} small />
                </div>
                <p className="text-sm text-ink-muted">
                  {who} · <span className="font-mono">{fmtTime(r.createdAt)}</span>
                </p>
                {r.provenance ? (
                  <p className="text-sm text-ink-muted">
                    Read by {r.provenance.model} ({r.provenance.provider}) at{" "}
                    <span className="font-mono">{fmtTime(r.provenance.extractedAt)}</span> · took{" "}
                    <span className="font-mono">{Math.max(1, Math.round(r.provenance.durationMs / 1000))}</span> s
                  </p>
                ) : null}
                {r.origin === "REAL_VISION" && r.uncertainFields.length ? (
                  <p className="text-sm">The AI was not sure about: {r.uncertainFields.map(uncertainLabel).join(", ")}.</p>
                ) : null}
                {r.origin === "REAL_VISION" && r.warnings.length ? (
                  <ul className="grid gap-1 text-sm">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {r.note ? <blockquote className="italic">“{r.note}”</blockquote> : null}
                {baseIsAi && base ? (
                  <AiDiff base={base} next={r} />
                ) : !baseNo ? (
                  <p className="text-sm">First version.</p>
                ) : (
                  <div className="rounded-md bg-sunken p-3">
                    <p className="text-sm font-bold">Changed from version {baseNo}</p>
                    {changes.length ? (
                      <ChangeList changes={changes} />
                    ) : (
                      <p className="text-sm">No figures changed. Confirmed as read.</p>
                    )}
                  </div>
                )}
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">
                    Show all figures in this version
                  </summary>
                  <FiguresTable revision={r} />
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Label for an `uncertainFields` key; unknown keys are shown as given. */
function uncertainLabel(key: string): string {
  if (key === "formType") return "Form type";
  if (key === "pollingUnitCode") return "Polling unit code on the sheet";
  return (FIGURE_KEYS as string[]).includes(key) ? figureLabel(key as FigureKey) : key;
}

const numberChanges = (base: ResultRevisionView, next: ResultRevisionView) =>
  FIGURE_KEYS.map((k) => ({ k, before: figureValue(base, k), after: figureValue(next, k) }));

/** Under the figures: how the confirmed version relates to the AI suggestion it started from. */
function AiBasis({ latest, revisions }: { latest: ResultRevisionView; revisions: ResultRevisionView[] }) {
  if (latest.origin !== "HUMAN_CORRECTION" || !latest.basedOnRevision) return null;
  const base = revisions.find((r) => r.revisionNumber === latest.basedOnRevision);
  if (!base || base.origin !== "REAL_VISION") return null;
  const all = numberChanges(base, latest);
  const k = all.filter((c) => c.before !== c.after).length;
  return (
    <p className="text-sm text-ink-muted">
      Based on an AI suggestion (version <span className="font-mono">{base.revisionNumber}</span>).{" "}
      <span className="font-mono">{k}</span> of <span className="font-mono">{all.length}</span> numbers changed by the
      person.
    </p>
  );
}

function AiDiff({ base, next }: { base: ResultRevisionView; next: ResultRevisionView }) {
  const all = numberChanges(base, next);
  const changed = all.filter((c) => c.before !== c.after);
  const kept = all.filter((c) => c.before === c.after);
  const show = (v: number | null) => (v === null ? "unreadable" : String(v));
  return (
    <div className="rounded-md bg-sunken p-3">
      <p className="text-sm font-bold">Changed from version {base.revisionNumber} (AI suggestion)</p>
      {changed.length ? (
        <>
          <ul className="grid gap-1">
            {changed.map((c) => (
              <li key={c.k}>
                {c.before === null ? (
                  <>
                    {figureLabel(c.k)}: AI could not read it <span aria-hidden>→</span> typed{" "}
                    <span className="font-mono">{show(c.after)}</span>
                  </>
                ) : (
                  <>
                    {figureLabel(c.k)}: AI suggested{" "}
                    <span className="font-mono">
                      <span className="sr-only">was </span>
                      <s className="text-ink-muted">{show(c.before)}</s>
                    </span>{" "}
                    <span aria-hidden>→</span> confirmed <span className="font-mono">{show(c.after)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {kept.length ? (
            <p className="mt-1 text-sm">Kept as suggested: {kept.map((c) => figureLabel(c.k)).join(", ")}.</p>
          ) : null}
        </>
      ) : (
        <p className="text-sm">No numbers changed. All AI suggestions were kept after checking.</p>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<TraceEvent["type"], string> = {
  CAPTURE_CLAIMED: "Photo taken",
  RECEIVED: "Received",
  EXTRACTION: "Figures read",
  HUMAN_CONFIRMATION: "Figures confirmed",
  REVIEW: "Review",
};

function Timeline({ events, revisions }: { events: TraceEvent[]; revisions: ResultRevisionView[] }) {
  const aiVersions = new Set(revisions.filter((r) => r.origin === "REAL_VISION").map((r) => String(r.revisionNumber)));
  return (
    <section aria-labelledby="timeline-h">
      <h2 id="timeline-h" className="text-xl">
        ProofTrail timeline
      </h2>
      <ol className="mt-3 grid gap-4">
        {events.map((ev, i) => {
          const versionRef = (ev.type === "EXTRACTION" || ev.type === "HUMAN_CONFIRMATION") && ev.ref ? ev.ref : null;
          return (
            <li key={`${ev.type}-${ev.at}-${i}`} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
              <span
                aria-hidden
                className={`mt-1.5 size-3 rounded-full border-2 border-ink ${ev.claimOnly ? "bg-surface" : "bg-ink"}`}
              />
              <div>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{fmtTime(ev.at)}</span>
                  {ev.claimOnly ? (
                    <Stamp small label="Device claim — not checked" icon={CloudOff} tone="outline" />
                  ) : (
                    <span className="text-ink-muted">(server time)</span>
                  )}
                </p>
                <p>
                  <strong>{ev.type === "EXTRACTION" && ev.ref && aiVersions.has(ev.ref) ? "AI suggestion" : EVENT_LABEL[ev.type]}.</strong>{" "}
                  {ev.summary}
                </p>
                {versionRef ? (
                  <a href={`#v${versionRef}`} className="inline-flex min-h-11 items-center font-bold text-primary">
                    See version {versionRef}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
