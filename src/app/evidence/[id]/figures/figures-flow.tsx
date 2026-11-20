"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, FlaskConical, Info, ScanText, TriangleAlert, WifiOff } from "lucide-react";
import {
  EvidenceTrace,
  ExtractResponse,
  ResultRevisionView,
  type ResultRevisionView as Revision,
} from "@/lib/contracts/trace";
import type { ExtractionMode, FormType } from "@/lib/contracts";
import { partyRosterFor } from "@/lib/seed/registry";
import { DemoTag } from "@/components/demo-band";
import { apiJson, issueMessages } from "@/components/client/api";
import { figureKeysFor, figureLabel, figureValue, FORM_TYPE_LABEL, Unreadable, Warnings, type FigureKey } from "@/components/evidence/figures";
import { Stamp } from "@/components/stamp";
import { latestRevisionOf, useTrace } from "@/components/evidence/use-trace";
import { useOnline } from "@/lib/offline/use-network";
import {
  blockingProblems,
  changedFromAi,
  clearDraft,
  consistencyChecks,
  DIGITS,
  draftFromRevision,
  fieldNumber,
  isAiDraft,
  loadDraft,
  saveDraft,
  toConfirmRequest,
  type Draft,
  type FieldDraft,
  type MetaDraft,
  type Problem,
  type ProblemKey,
} from "./draft";
import { PhotoPanel } from "./photo-panel";

export function FiguresSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-4 pt-2 lg:grid-cols-12">
      <p className="sr-only">Loading the figures form…</p>
      <div className="h-[clamp(160px,32svh,280px)] rounded-lg bg-sunken lg:col-span-7 lg:h-[70dvh]" />
      <div className="grid content-start gap-3 lg:col-span-5">
        <div className="h-16 rounded-md bg-sunken" />
        <div className="h-16 rounded-md bg-sunken" />
        <div className="h-16 rounded-md bg-sunken" />
      </div>
    </div>
  );
}

type Step = "mode" | "enter" | "check";

export function FiguresFlow({ id }: { id: string }) {
  const { state, reload, retry } = useTrace(id);

  if (state.status === "loading") return <FiguresSkeleton />;
  if (state.status === "failed") {
    const msg =
      state.kind === "notFound"
        ? "We could not find this record. It may be private, or the link may be wrong."
        : state.kind === "unauthenticated"
          ? "Your session has ended. Open PollTrace on the phone that sent this photo."
          : state.kind === "offline"
            ? "Connect to the internet to open this form."
            : "This form did not load.";
    return (
      <section className="mx-auto max-w-xl pt-4">
        <h1 className="text-xl">Enter the figures</h1>
        <p className="mt-2">{msg}</p>
        {state.kind === "notFound" ? (
          <Link href="/submissions" className="btn btn-secondary mt-4 w-full no-underline">
            Back to your submissions
          </Link>
        ) : state.kind === "unauthenticated" ? null : (
          <button type="button" className="btn btn-secondary mt-4 w-full" onClick={retry}>
            Try again
          </button>
        )}
      </section>
    );
  }
  const trace = state.trace;
  if (!trace.permissions.canConfirm) {
    return (
      <section className="mx-auto max-w-xl pt-4">
        <h1 className="text-xl">Enter the figures</h1>
        <p className="mt-2">Only the person who sent this photo can confirm its figures.</p>
        <Link href={`/evidence/${id}`} className="btn btn-secondary mt-4 w-full no-underline">
          Back to this record
        </Link>
      </section>
    );
  }
  return <Flow trace={trace} reloadTrace={reload} />;
}

function Flow({ trace, reloadTrace }: { trace: EvidenceTrace; reloadTrace: () => void }) {
  const id = trace.evidence.id;
  const roster = partyRosterFor(trace.evidence.electionId);
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const [extracted, setExtracted] = useState<Revision | null>(null);
  const [stoppedNote, setStoppedNote] = useState(false);
  const traceLatest = latestRevisionOf(trace);
  const latest =
    extracted && (!traceLatest || extracted.revisionNumber > traceLatest.revisionNumber) ? extracted : traceLatest;

  const requested = params.get("step");
  const step: Step = !latest ? "mode" : requested === "check" ? "check" : "enter";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [stale, setStale] = useState<Revision | null>(null);

  const [resubmit, setResubmit] = useState(0);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Load or start the local draft once per latest revision number (state adjusted during render).
  if (latest && loadedFor !== latest.revisionNumber) {
    setLoadedFor(latest.revisionNumber);
    if (!draft || draft.basedOnRevision < latest.revisionNumber) {
      const stored = draft ?? loadDraft(id);
      if (stored && stored.basedOnRevision === latest.revisionNumber) {
        setDraft(stored);
      } else if (stored && stored.basedOnRevision < latest.revisionNumber) {
        // Typing exists for an older version: keep it and let the person choose.
        setDraft(stored);
        setStale(latest);
      } else {
        // Fresh form from the latest version; it is written to this device on the first change.
        setDraft(draftFromRevision(latest, null, roster));
      }
    }
  }

  const update = (fn: (d: Draft) => Draft) => {
    setDraft((d) => {
      if (!d) return d;
      const next = fn(d);
      setStorageWarning(!saveDraft(id, next));
      return next;
    });
  };

  const go = (s: Step, hash = "") => router.push(`/evidence/${id}/figures?step=${s}${hash}`);

  const onExtracted = (res: ExtractResponse) => {
    const d = draftFromRevision(res.revision, res.notice, roster);
    saveDraft(id, d);
    setDraft(d);
    setExtracted(res.revision);
    reloadTrace();
    router.replace(`/evidence/${id}/figures?step=enter`);
  };

  const backLink = (
    <Link href={`/evidence/${id}`} className="inline-flex min-h-11 items-center gap-2 font-bold text-primary">
      <ArrowLeft aria-hidden size={20} />
      Back to this record
    </Link>
  );

  const photo = (
    // Block flow below lg: the sticky wrapper's containing block is the whole page, not a grid row.
    <div
      data-sticky-photo
      className="sticky top-0 z-10 -mx-4 bg-canvas px-4 lg:top-4 lg:col-span-7 lg:mx-0 lg:self-start lg:px-0"
    >
      <PhotoPanel src={trace.originalUrl} synthetic={trace.evidence.synthetic} code={trace.evidence.pollingUnitCode} />
    </div>
  );

  if (step === "mode") {
    return (
      <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
        <div className="lg:col-span-12">{backLink}</div>
        {photo}
        <div className="lg:col-span-5">
          <ModeStep
            trace={trace}
            online={online}
            onExtracted={onExtracted}
            onStopped={() => setStoppedNote(true)}
            onCheckAgain={reloadTrace}
          />
        </div>
      </div>
    );
  }
  if (!draft || !latest) return <FiguresSkeleton />;

  const keepMine = (m: Revision) => {
    update((d) => ({ ...d, basedOnRevision: m.revisionNumber }));
    setStale(null);
    // On the check step "Keep my figures" resubmits straight away, based on version m.
    if (step === "check") setResubmit((n) => n + 1);
  };
  const adoptTheirs = (m: Revision) => {
    const d = draftFromRevision(m, null, roster);
    saveDraft(id, d);
    setDraft(d);
    setStale(null);
    go("enter");
  };

  return (
    <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
      <div className="lg:col-span-12">{backLink}</div>
      {photo}
      <div className="lg:col-span-5">
        {stoppedNote && step === "enter" ? (
          <p role="status" className="mt-3 rounded-md bg-sunken p-3">
            Stopped waiting. If the AI finishes later, its suggestion appears as a new version you can check. Your photo
            and earlier versions are unchanged.
          </p>
        ) : null}
        {stale ? (
          <StaleSlip latest={stale} draft={draft} onKeep={() => keepMine(stale)} onUse={() => adoptTheirs(stale)} />
        ) : null}
        {!online ? (
          <p role="status" className="mt-3 flex items-start gap-3 rounded-md bg-sunken p-4">
            <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>
              You are offline. Your typing is saved on this device. You can confirm when you are back online.
            </span>
          </p>
        ) : null}
        {storageWarning ? (
          <p role="alert" className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-3">
            This browser would not save your typing. Keep this page open until you confirm.
          </p>
        ) : null}
        {step === "enter" ? (
          <EnterStep
            trace={trace}
            latest={latest}
            draft={draft}
            update={update}
            onNext={() => go("check")}
            onLater={() => router.push(`/evidence/${id}`)}
          />
        ) : (
          <CheckStep
            trace={trace}
            latest={latest}
            draft={draft}
            update={update}
            online={online}
            blocked={stale !== null}
            onEdit={(k) => go("enter", k ? `#f-${k}` : "")}
            onStale={(r) => {
              setStale(r);
              reloadTrace();
            }}
            resubmit={resubmit}
            onConfirmed={(n) => {
              clearDraft(id);
              router.push(`/evidence/${id}?confirmed=${n}#figures`);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step 1: mode */

type ModeFailure =
  | "TIMEOUT"
  | "REJECTED"
  | "IN_PROGRESS"
  | "LIMIT"
  | "RATE"
  | "UNAVAILABLE"
  | "NETWORK"
  | "UNSUPPORTED"
  | "OTHER";

const FAILURE_COPY: Record<Exclude<ModeFailure, "UNSUPPORTED">, { text: string; retry: string | null }> = {
  TIMEOUT: { text: "The AI took too long to answer.", retry: "Try again" },
  REJECTED: { text: "The AI’s answer could not be used.", retry: "Try again" },
  IN_PROGRESS: { text: "The AI is already reading this photo. Wait a moment, then check again.", retry: "Check again" },
  LIMIT: { text: "The AI has already read this photo the most times allowed.", retry: null },
  RATE: { text: "Too many requests right now. Wait a minute, then try again.", retry: "Try again" },
  UNAVAILABLE: { text: "AI reading is not available right now.", retry: null },
  NETWORK: { text: "Could not reach the server.", retry: "Try again" },
  OTHER: { text: "Could not start.", retry: "Try again" },
};

function failureOf(r: { kind: string; status?: number; code?: string | null }): ModeFailure {
  if (r.kind === "network") return "NETWORK";
  switch (r.code) {
    case "EXTRACTION_UNSUPPORTED_DOCUMENT":
      return "UNSUPPORTED";
    case "EXTRACTION_TIMEOUT":
      return "TIMEOUT";
    case "EXTRACTION_REJECTED":
      return "REJECTED";
    case "EXTRACTION_IN_PROGRESS":
      return "IN_PROGRESS";
    case "EXTRACTION_LIMIT_REACHED":
      return "LIMIT";
    case "RATE_LIMITED":
      return "RATE";
    case "MODE_UNAVAILABLE":
      return "UNAVAILABLE";
  }
  if (r.status === 504) return "TIMEOUT";
  if (r.status === 502) return "REJECTED";
  return "OTHER";
}

/** Seconds since `from`, updated once a second while mounted. Not announced to screen readers. */
function useElapsed(from: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (from === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from]);
  return from === null ? 0 : Math.max(0, Math.floor((now - from) / 1000));
}

function ModeStep({
  trace,
  online,
  onExtracted,
  onStopped,
  onCheckAgain,
}: {
  trace: EvidenceTrace;
  online: boolean;
  onExtracted: (r: ExtractResponse) => void;
  onStopped: () => void;
  onCheckAgain: () => void;
}) {
  const id = trace.evidence.id;
  const available = trace.permissions.availableExtractionModes;
  const [aiHidden, setAiHidden] = useState(false);
  const aiAvailable = available.includes("REAL_VISION") && !aiHidden;
  const options = (["REAL_VISION", "MANUAL", "DEMO_FIXTURE"] as const).filter(
    (m) => available.includes(m) && (m !== "REAL_VISION" || aiAvailable),
  );
  const manualOnly = options.length === 1 && options[0] === "MANUAL";
  const [choice, setChoice] = useState<ExtractionMode | null>(null);
  const [busy, setBusy] = useState<ExtractionMode | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<ModeFailure | null>(null);
  const [chooseError, setChooseError] = useState(false);
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const elapsed = useElapsed(busy === "REAL_VISION" ? startedAt : null);
  const uid = useId();
  const extracting = busy === "REAL_VISION";

  async function start(mode: ExtractionMode) {
    if (inFlight.current) return; // one request at a time (double click sends one)
    inFlight.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(mode);
    setFailure(null);
    setStartedAt(mode === "REAL_VISION" ? Date.now() : null);
    try {
      const r = await apiJson(`/api/evidence/${id}/extract`, ExtractResponse, {
        method: "POST",
        body: { mode },
        signal: ctrl.signal,
      });
      if (r.ok) return onExtracted(r.data);
      const f = failureOf(r.kind === "http" ? r : { kind: r.kind });
      // No point offering AI again for this photo after these.
      if (f === "LIMIT" || f === "UNSUPPORTED") setAiHidden(true);
      setFailure(f);
    } catch {
      /* aborted by "Stop and type myself": handled there */
    } finally {
      inFlight.current = false;
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(null);
    }
  }

  function typeMyself(stopped: boolean) {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      inFlight.current = false;
    }
    if (stopped) onStopped();
    void start("MANUAL");
  }

  const typeButton = (
    <button
      type="button"
      className={`btn ${failure && FAILURE_COPY[failure as Exclude<ModeFailure, "UNSUPPORTED">]?.retry ? "btn-secondary" : "btn-primary"}`}
      disabled={busy === "MANUAL"}
      onClick={() => typeMyself(false)}
    >
      {busy === "MANUAL" ? "Preparing the form…" : "Type the figures myself"}
    </button>
  );

  return (
    <section aria-labelledby={`${uid}-h`} className="pt-2">
      <h1 id={`${uid}-h`} className="text-xl md:text-2xl">
        Enter the figures
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 1 of 3</p>
      <p className="mt-2">
        <span className="font-mono font-semibold">{trace.evidence.pollingUnitCode}</span>{" "}
        {trace.evidence.synthetic ? <DemoTag /> : null} {trace.evidence.pollingUnitName}
      </p>

      {!available.includes("REAL_VISION") ? (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-sunken p-3">
          <Info aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>Automatic reading is not available in this version. Figures are typed in by a person.</span>
        </p>
      ) : null}

      {!online ? (
        <div role="status" className="mt-4 rounded-md bg-sunken p-3">
          <p className="flex items-start gap-2">
            <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>
              {aiAvailable
                ? "You are offline. AI reading needs a connection. You can type the figures now."
                : "You are offline. Preparing the form needs a connection."}
            </span>
          </p>
        </div>
      ) : null}

      {manualOnly ? null : (
        <fieldset className="mt-4" disabled={busy !== null} aria-describedby={chooseError ? `${uid}-err` : undefined}>
          <legend className="text-lg font-bold">How do you want to enter the figures?</legend>
          {chooseError ? (
            <p id={`${uid}-err`} className="mt-1 text-caution">
              Choose one to continue.
            </p>
          ) : null}
          <div className="mt-2 grid gap-2">
            {options.includes("REAL_VISION") ? (
              <Radio name={`${uid}-mode`} checked={choice === "REAL_VISION"} onChange={() => setChoice("REAL_VISION")}>
                <span className="block font-bold">Read the figures with AI</span>
                <span className="block text-sm">
                  An AI model reads the photo and suggests each number. It can make mistakes. You must check every
                  number against the photo before you confirm.
                </span>
                <span className="mt-1 block text-sm">Your photo is sent to an outside AI service to be read.</span>
              </Radio>
            ) : null}
            {options.includes("MANUAL") ? (
              <Radio name={`${uid}-mode`} checked={choice === "MANUAL"} onChange={() => setChoice("MANUAL")}>
                <span className="block font-bold">Type the figures yourself</span>
                <span className="block text-sm">You read the photo and type each number.</span>
              </Radio>
            ) : null}
            {options.includes("DEMO_FIXTURE") ? (
              <Radio name={`${uid}-mode`} checked={choice === "DEMO_FIXTURE"} onChange={() => setChoice("DEMO_FIXTURE")}>
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  Load demo figures <DemoTag />
                </span>
                <span className="block text-sm">
                  Demo figures — not read from this photo. For the synthetic demo only. You must still check each one.
                </span>
              </Radio>
            ) : null}
          </div>
        </fieldset>
      )}

      {extracting ? (
        <div role="status" className="mt-4 rounded-md bg-sunken p-4">
          <p className="flex items-start gap-2 font-bold">
            <ScanText aria-hidden size={20} className="mt-0.5 shrink-0" />
            Reading the figures…
          </p>
          <p className="mt-1">An AI model is reading your photo. This can take up to a minute on a slow network. Keep this page open.</p>
          <p aria-hidden className="mt-2 font-mono">
            Waiting {elapsed} s
          </p>
          {elapsed >= 30 ? <p className="mt-1">Still reading. You can keep waiting, or type the figures yourself.</p> : null}
          <button type="button" className="btn btn-secondary mt-3 w-full md:w-auto" onClick={() => typeMyself(true)}>
            Stop and type myself
          </button>
        </div>
      ) : null}

      {busy === "MANUAL" || busy === "DEMO_FIXTURE" ? (
        <p role="status" className="mt-3">
          Preparing the form…
        </p>
      ) : null}

      {failure === "UNSUPPORTED" ? (
        <div role="alert" className="mt-4 rounded-md border-2 border-caution bg-surface p-4">
          <p className="flex items-start gap-2 font-bold">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
            The AI could not find result figures in this photo.
          </p>
          <p className="mt-1">
            It may not be a result sheet, or it may be too blurred, dark or cut off. This does not change your photo or
            its fingerprint.
          </p>
          <p className="mt-1">Type the figures you can read, and tick &ldquo;I can&rsquo;t read this&rdquo; for any you cannot.</p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => typeMyself(false)}>
              {busy === "MANUAL" ? "Preparing the form…" : "Type the figures myself"}
            </button>
            <Link href="/capture" className="inline-flex min-h-11 items-center font-bold text-primary">
              Retake the photo
            </Link>
          </div>
        </div>
      ) : failure ? (
        <div role="alert" className="mt-4 rounded-md border-2 border-caution bg-caution-tint p-4">
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
            <span>
              {FAILURE_COPY[failure].text} <strong>Nothing was saved.</strong>
            </span>
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            {FAILURE_COPY[failure].retry ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => {
                  if (failure === "IN_PROGRESS") {
                    setFailure(null);
                    onCheckAgain();
                  } else if (choice) void start(choice);
                  else void start("REAL_VISION");
                }}
              >
                {FAILURE_COPY[failure].retry}
              </button>
            ) : null}
            {typeButton}
          </div>
        </div>
      ) : null}

      {/* While a failure panel is open its own buttons are the next step; the main button would compete. */}
      <div className={`mt-6 grid gap-2 md:max-w-sm ${failure ? "hidden" : ""}`}>
        {manualOnly ? (
          <button type="button" className="btn btn-primary w-full" disabled={busy !== null || !online} onClick={() => void start("MANUAL")}>
            {busy ? "Preparing the form…" : "Start typing"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy !== null || !online}
            onClick={() => {
              if (!choice) return setChooseError(true);
              setChooseError(false);
              void start(choice);
            }}
          >
            {extracting ? "Reading…" : busy ? "Preparing the form…" : choice === "REAL_VISION" ? "Read with AI" : "Continue"}
          </button>
        )}
        {!online ? (
          <>
            <p className="text-sm">Needs a connection</p>
            {aiAvailable ? typeButton : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-md border-2 p-3 ${
        checked ? "border-primary bg-primary-tint" : "border-rule bg-surface"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-5 shrink-0 accent-primary" />
      <span>{children}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ step 2: enter */

/** Same words, ignoring case, punctuation and spacing. */
const sameText = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b);
};

/** Server notices that only repeat this panel's heading and text (shown once, not twice). */
const DUPLICATE_AI_NOTICES = [
  "AI suggestions — check every number.",
  "Read by an AI model. Check every figure against the photo before confirming.",
];

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function SourceNotice({ draft, latest }: { draft: Draft; latest: Revision }) {
  if (isAiDraft(draft)) {
    const p = latest.revisionNumber === draft.basedOnRevision ? latest.provenance : null;
    const uncertain =
      figureKeysFor(draft.parties).filter((k) => draft.fields[k].uncertain).length +
      (draft.formTypeMeta.uncertain ? 1 : 0) +
      (draft.codeMeta.uncertain ? 1 : 0);
    return (
      <div className="mt-3 rounded-md bg-sunken p-3">
        <p className="flex items-start gap-2 font-bold">
          <ScanText aria-hidden size={20} className="mt-0.5 shrink-0" />
          AI suggestions — check every number.
        </p>
        <p className="mt-1">
          An AI model read the photo and suggested these figures. It can misread numbers. Compare each one with the
          photo, fix any that are wrong, then confirm.
        </p>
        {draft.notice && !DUPLICATE_AI_NOTICES.some((t) => sameText(draft.notice ?? "", t)) ? (
          <p className="mt-1">{draft.notice}</p>
        ) : null}
        {p ? (
          <p className="mt-1 text-sm text-ink-muted">
            Read by {p.model} at <span className="font-mono">{hhmm(p.extractedAt)}</span> · took{" "}
            <span className="font-mono">{Math.max(1, Math.round(p.durationMs / 1000))}</span> s
          </p>
        ) : null}
        {uncertain > 0 ? (
          <p className="mt-1 font-bold">
            <span className="font-mono">{uncertain}</span> {uncertain === 1 ? "number" : "numbers"} the AI was not sure
            about {uncertain === 1 ? "is" : "are"} marked below.
          </p>
        ) : null}
      </div>
    );
  }
  if (draft.baseOrigin === "DEMO_FIXTURE") {
    return (
      <div className="mt-3 rounded-md border-2 border-dashed border-demo bg-demo-tint p-3 text-demo">
        <p className="flex items-start gap-2">
          <FlaskConical aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>{draft.notice ?? "Demo figures — not read from this photo."}</span>
        </p>
        <p className="mt-1 font-bold">Check each number against the photo before you confirm.</p>
      </div>
    );
  }
  if (latest.humanConfirmed) {
    return (
      <p className="mt-3 rounded-md bg-sunken p-3">
        You are correcting version <span className="font-mono">{latest.revisionNumber}</span>. It will be kept; your
        changes become version <span className="font-mono">{latest.revisionNumber + 1}</span>.
      </p>
    );
  }
  return <p className="mt-3 rounded-md bg-sunken p-3">{draft.notice ?? "Type each number as you read it on the photo."}</p>;
}

function EnterStep({
  trace,
  latest,
  draft,
  update,
  onNext,
  onLater,
}: {
  trace: EvidenceTrace;
  latest: Revision;
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  onNext: () => void;
  onLater: () => void;
}) {
  const uid = useId();
  const [showBlocking, setShowBlocking] = useState(false);
  const unitCode = trace.evidence.pollingUnitCode;
  const checks = consistencyChecks(draft, unitCode);
  const problems = blockingProblems(draft);

  // Arriving from "Edit" on the check step: focus that field.
  useEffect(() => {
    const h = location.hash.slice(1);
    if (h) {
      const el = document.getElementById(h) as HTMLElement | null;
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    }
  }, []);

  const setField = (k: FigureKey, patch: Partial<FieldDraft>) =>
    update((d) => ({ ...d, fields: { ...d.fields, [k]: { ...d.fields[k], ...patch } } }));
  const setMeta = (which: "formTypeMeta" | "codeMeta", patch: Partial<MetaDraft>) =>
    update((d) => ({ ...d, [which]: { ...d[which], ...patch } }));

  const next = () => {
    if (problems.length) {
      setShowBlocking(true);
      document.getElementById(`f-${problems[0].key}`)?.focus();
      return;
    }
    onNext();
  };

  const actions = (
    <>
      <button type="button" className="btn btn-primary w-full" onClick={next}>
        Check before confirming
      </button>
      <button type="button" className="btn btn-secondary w-full" onClick={onLater}>
        Save and finish later
      </button>
    </>
  );

  return (
    <section aria-labelledby={`${uid}-h`}>
      <SourceNotice draft={draft} latest={latest} />
      <h1 id={`${uid}-h`} className="mt-4 text-xl md:text-2xl">
        {isAiDraft(draft) ? "Check the AI’s figures" : "Type the figures"}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 2 of 3</p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
        className="mt-4 grid gap-4">
        <fieldset className="slip [&>p:first-of-type]:border-t-0">
          <legend className="sr-only">Sheet details</legend>
          <p aria-hidden className="px-4 pt-3 text-lg font-bold">
            Sheet details
          </p>
          <div className="px-4 py-3">
            <fieldset id="f-formType" tabIndex={-1}>
              <legend className="flex flex-wrap items-center gap-2 font-bold">
                Form type
                {draft.formTypeMeta.aiValue !== null && draft.formType === draft.formTypeMeta.aiValue ? <AiStamp /> : null}
              </legend>
              <p id={`${uid}-ft-hint`} className="text-sm text-ink-muted">
                Printed at the top of the sheet.
              </p>
              <div className="mt-2 flex flex-wrap gap-2" aria-describedby={`${uid}-ft-hint`}>
                {(Object.keys(FORM_TYPE_LABEL) as FormType[]).map((ft) => (
                  <label
                    key={ft}
                    className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 px-3 ${
                      draft.formType === ft ? "border-primary bg-primary-tint" : "border-rule bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${uid}-ft`}
                      checked={draft.formType === ft}
                      onChange={() => update((d) => ({ ...d, formType: ft, formTypeMeta: { ...d.formTypeMeta, checked: false } }))}
                      className="size-5 accent-primary"
                    />
                    {FORM_TYPE_LABEL[ft]}
                  </label>
                ))}
              </div>
              {draft.formTypeMeta.uncertain && draft.formType === draft.formTypeMeta.aiValue ? (
                <UncertainCheck meta={draft.formTypeMeta} onChange={(checked) => setMeta("formTypeMeta", { checked })} />
              ) : null}
            </fieldset>
            <label htmlFor="f-pollingUnitCode" className="mt-4 flex flex-wrap items-center gap-2 font-bold">
              Polling unit code on the sheet
              {draft.codeMeta.aiValue !== null && draft.code.trim() === draft.codeMeta.aiValue ? <AiStamp /> : null}
            </label>
            <p id={`${uid}-code-hint`} className="text-sm text-ink-muted">
              Type it exactly as written. Leave blank if you can&rsquo;t read it.
            </p>
            <input
              id="f-pollingUnitCode"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={draft.code}
              onChange={(e) => update((d) => ({ ...d, code: e.target.value, codeMeta: { ...d.codeMeta, checked: false } }))}
              aria-describedby={`${uid}-code-hint`}
              className={`field mt-2 font-mono ${
                draft.codeMeta.uncertain && draft.code.trim() !== "" && draft.code.trim() === draft.codeMeta.aiValue
                  ? "border-2 border-caution"
                  : ""
              }`}
            />
            {draft.codeMeta.aiValue !== null && draft.code.trim() !== draft.codeMeta.aiValue ? (
              <p className="mt-1 text-sm text-ink-muted">
                Changed by you (AI suggested <span className="font-mono">{draft.codeMeta.aiValue}</span>)
              </p>
            ) : null}
            {draft.codeMeta.uncertain && draft.code.trim() !== "" && draft.code.trim() === draft.codeMeta.aiValue ? (
              <UncertainCheck meta={draft.codeMeta} onChange={(checked) => setMeta("codeMeta", { checked })} />
            ) : null}
          </div>
        </fieldset>

        <fieldset className="slip [&>p:first-of-type]:border-t-0">
          <legend className="sr-only">Votes for each party</legend>
          <p aria-hidden className="px-4 pt-3 text-lg font-bold">
            Votes for each party
          </p>
          {draft.parties.map((k) => (
            <NumberField key={k} k={k} field={draft.fields[k]} setField={setField} showCode />
          ))}
        </fieldset>

        <fieldset className="slip [&>p:first-of-type]:border-t-0">
          <legend className="sr-only">Totals</legend>
          <p aria-hidden className="px-4 pt-3 text-lg font-bold">
            Totals
          </p>
          {(["accreditedVoters", "rejectedVotes", "validVotes"] as const).map((k) => (
            <NumberField key={k} k={k} field={draft.fields[k]} setField={setField} />
          ))}
        </fieldset>

        <ThingsToCheck
          checks={checks}
          blocking={showBlocking ? problems : []}
          serverWarnings={latest.warnings}
          version={latest.revisionNumber}
          ai={isAiDraft(draft)}
        />
      </form>

      <div className="mt-6 grid gap-2">{actions}</div>
    </section>
  );
}

/** If the focused field (and its label) sits under the sticky photo, scroll it just below. */
function keepClearOfStickyPhoto(input: HTMLElement) {
  const panel = document.querySelector("[data-sticky-photo]");
  if (!panel || getComputedStyle(panel).position !== "sticky") return;
  const row = input.parentElement ?? input;
  const covered = panel.getBoundingClientRect().bottom + 8 - row.getBoundingClientRect().top;
  if (covered > 0) window.scrollBy({ top: -covered });
}

function AiStamp() {
  return (
    <span className="whitespace-nowrap">
      <Stamp small label="AI suggestion" icon={ScanText} tone="tealOutline" />
    </span>
  );
}

/** Required tick for a value the AI was not sure about. Clears when the value is edited. */
function UncertainCheck({ meta, onChange }: { meta: { checked: boolean }; onChange: (checked: boolean) => void }) {
  return (
    <div className="mt-2">
      <p className="flex items-start gap-1 text-caution">
        <TriangleAlert aria-hidden size={18} className="mt-0.5 shrink-0" />
        The AI was not sure about this number. Look closely at the photo.
      </p>
      <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={meta.checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-6 accent-primary"
        />
        I checked this on the photo
      </label>
    </div>
  );
}

function NumberField({
  k,
  field,
  setField,
  showCode = false,
}: {
  k: FigureKey;
  field: FieldDraft;
  setField: (k: FigureKey, patch: Partial<FieldDraft>) => void;
  showCode?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const id = `f-${k}`;
  const invalid = touched && !field.unreadable && field.value.trim() !== "" && !DIGITS.test(field.value.trim());
  const changed = changedFromAi(field);
  const keptAi = field.aiValue !== null && !changed;
  // Uncertain and still the AI's value: needs a close look and a tick.
  const showUncertain = field.uncertain && field.aiValue !== null && !field.unreadable && !changed;
  const aiCouldNotRead = field.uncertain && field.aiValue === null && !field.unreadable;
  const describedBy = [
    showCode ? `${id}-code` : null,
    invalid ? `${id}-err` : null,
    field.unreadable ? `${id}-unread` : null,
    field.flagged && !field.unreadable ? `${id}-flag` : null,
    showUncertain ? `${id}-unsure` : null,
    aiCouldNotRead ? `${id}-noread` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="font-bold">
          {figureLabel(k)}
        </label>
        {showCode ? (
          <span id={`${id}-code`} className="font-mono text-xs text-ink-muted">
            {k}
          </span>
        ) : null}
        {field.fromDemo ? <DemoTag /> : null}
        {keptAi ? <AiStamp /> : null}
      </div>
      {changed ? (
        <p className="text-sm text-ink-muted">
          Changed by you (AI suggested <span className="font-mono">{field.aiValue}</span>)
        </p>
      ) : null}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={field.unreadable ? "" : field.value}
        disabled={field.unreadable}
        onChange={(e) => setField(k, { value: e.target.value, fromDemo: false, checked: false })}
        onBlur={() => setTouched(true)}
        onFocus={(e) => keepClearOfStickyPhoto(e.currentTarget)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`field mt-1 w-36 text-right font-mono ${
          invalid || showUncertain || (field.flagged && !field.unreadable) ? "border-2 border-caution" : ""
        }`}
      />
      {invalid ? (
        <p id={`${id}-err`} className="mt-1 text-caution">
          Use numbers only (0–9).
        </p>
      ) : null}
      {field.flagged && !field.unreadable ? (
        <p id={`${id}-flag`} className="mt-1 text-sm">
          Check this one carefully.
        </p>
      ) : null}
      {aiCouldNotRead && field.value.trim() === "" ? (
        <p id={`${id}-noread`} className="mt-1 flex items-start gap-1 text-caution">
          <TriangleAlert aria-hidden size={18} className="mt-0.5 shrink-0" />
          The AI could not read this. Type it, or tick &ldquo;I can&rsquo;t read this&rdquo;.
        </p>
      ) : null}
      {showUncertain ? (
        <div id={`${id}-unsure`}>
          <UncertainCheck meta={field} onChange={(checked) => setField(k, { checked })} />
        </div>
      ) : null}
      {field.unreadable ? (
        <p id={`${id}-unread`} className="mt-1 flex items-center gap-1 text-caution">
          <TriangleAlert aria-hidden size={18} />
          Unreadable — will be marked for review
        </p>
      ) : null}
      <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={field.unreadable}
          onChange={(e) => setField(k, { unreadable: e.target.checked, fromDemo: false, checked: false })}
          className="size-5 accent-primary"
        />
        I can&rsquo;t read this
      </label>
    </div>
  );
}

function ThingsToCheck({
  checks,
  blocking,
  serverWarnings,
  version,
  ai,
}: {
  checks: string[];
  blocking: Problem[];
  serverWarnings: string[];
  version: number;
  ai: boolean;
}) {
  if (!checks.length && !blocking.length && !serverWarnings.length) return null;
  return (
    <section aria-label="Things to check" className="grid gap-3">
      <h2 className="font-sans text-lg font-bold">Things to check</h2>
      {blocking.length ? (
        <ul role="alert" className="grid gap-2 rounded-md border-2 border-caution bg-caution-tint p-3">
          {blocking.map((p) => (
            <li key={p.key} className="flex items-start gap-2">
              <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
              <a href={`#f-${p.key}`} className="text-ink">
                {p.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Not a live region: re-announcing on every keystroke is noise. Shown again on the check step. */}
      <Warnings warnings={checks} />
      <Warnings
        warnings={serverWarnings}
        heading={ai ? "Noted when the AI read the photo:" : `Noted by the server when version ${version} was saved:`}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ step 3: check */

type SubmitError =
  | { kind: "network" }
  | { kind: "invalid"; messages: string[] }
  | { kind: "forbidden" }
  | { kind: "other" };

function CheckStep({
  trace,
  latest,
  draft,
  update,
  online,
  blocked,
  onEdit,
  onStale,
  onConfirmed,
  resubmit,
}: {
  trace: EvidenceTrace;
  latest: Revision;
  draft: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  online: boolean;
  blocked: boolean;
  onEdit: (k?: ProblemKey) => void;
  onStale: (r: Revision) => void;
  onConfirmed: (revisionNumber: number) => void;
  resubmit: number;
}) {
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const problems = useMemo(() => blockingProblems(draft), [draft]);
  const checks = consistencyChecks(draft, trace.evidence.pollingUnitCode);
  const errorRef = useRef<HTMLDivElement>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await apiJson(`/api/evidence/${trace.evidence.id}/confirm`, ResultRevisionView, {
      method: "POST",
      body: toConfirmRequest(draft),
    });
    if (r.ok) return onConfirmed(r.data.revisionNumber);
    if (r.kind === "http" && r.code === "STALE_REVISION") {
      // Fetch the newer version so the person can compare it with their typing.
      const t = await apiJson(`/api/evidence/${trace.evidence.id}/trace`, EvidenceTrace);
      setBusy(false);
      const newest = t.ok ? latestRevisionOf(t.data) : null;
      if (newest) return onStale(newest);
      return setError({ kind: "other" });
    }
    setBusy(false);
    if (r.kind === "network") setError({ kind: "network" });
    else if (r.kind === "http" && r.status === 400) {
      const msgs = issueMessages(r.body);
      setError({ kind: "invalid", messages: msgs.length ? msgs : [r.message ?? "the figures were not accepted"] });
    } else if (r.kind === "http" && (r.status === 403 || r.status === 401)) setError({ kind: "forbidden" });
    else setError({ kind: "other" });
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  const lastResubmit = useRef(resubmit);
  useEffect(() => {
    if (resubmit !== lastResubmit.current) {
      lastResubmit.current = resubmit;
      void confirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per "Keep my figures"
  }, [resubmit]);

  if (problems.length) {
    // Arrived here by URL without resolving every field: send the person back.
    return (
      <section className="mt-4">
        <h1 className="text-xl md:text-2xl">Check before you confirm</h1>
        <p className="mt-2">Some figures are still empty. Type each number, or tick &ldquo;I can&rsquo;t read this&rdquo;.</p>
        <button type="button" className="btn btn-primary mt-4 w-full" onClick={() => onEdit(problems[0].key)}>
          Go back and edit
        </button>
      </section>
    );
  }

  const canSubmit = online && !busy && !blocked;
  const actions = (
    <>
      <button type="button" className="btn btn-primary w-full" disabled={!canSubmit} onClick={() => void confirm()}>
        {busy ? "Saving…" : "Confirm figures"}
      </button>
      <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => onEdit()}>
        Go back and edit
      </button>
    </>
  );
  const note = !online ? <p className="text-sm">Needs a connection</p> : undefined;

  const ai = isAiDraft(draft);
  /** Where each confirmed value came from (AI drafts only). */
  const sourceOf = (f: FieldDraft): ReactNode => {
    if (!ai) return null;
    if (f.unreadable) return null; // the value cell already says "Unreadable"
    if (f.aiValue !== null && !changedFromAi(f))
      return (
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm">
          <AiStamp /> kept after checking
        </span>
      );
    if (f.aiValue !== null)
      return (
        <span className="mt-0.5 block text-sm">
          Changed by you{" "}
          <s className="font-mono text-ink-muted">
            <span className="sr-only">AI suggested </span>
            {f.aiValue}
          </s>
        </span>
      );
    return <span className="mt-0.5 block text-sm">Typed by you</span>;
  };
  const rows: Array<{
    key: ProblemKey | null;
    label: string;
    value: ReactNode;
    demo: boolean;
    stack?: boolean;
    source?: ReactNode;
  }> = [
    { key: "formType", label: "Form type", value: FORM_TYPE_LABEL[draft.formType], demo: false },
    {
      key: "pollingUnitCode",
      label: "Code on sheet",
      value: draft.code.trim() || <span className="font-sans text-ink-muted">Not given</span>,
      demo: false,
      // Codes are long: full width under the label, so they never split mid-code at 360px.
      stack: true,
    },
    ...figureKeysFor(draft.parties).map((k) => {
      const n = fieldNumber(draft.fields[k]);
      return {
        key: k,
        label: figureLabel(k),
        value: n === null ? <Unreadable /> : n,
        demo: draft.fields[k].fromDemo,
        source: sourceOf(draft.fields[k]),
      };
    }),
  ];

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h1 id={`${uid}-h`} className="mt-4 text-xl md:text-2xl">
        Check before you confirm
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 3 of 3</p>
      <p className="mt-3 font-bold">You are confirming these figures as you read them on the photo.</p>
      <p>This does not say the result is correct. It says this is what you could read.</p>
      {ai ? <p className="mt-1">AI suggestions you keep become your confirmed figures.</p> : null}

      {error ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-md border-2 border-caution bg-caution-tint p-3">
          {error.kind === "network" ? (
            <>
              <p>Could not reach the server. Nothing was confirmed. Your typing is kept. Try again.</p>
              <button type="button" className="btn btn-secondary mt-2" disabled={!canSubmit} onClick={() => void confirm()}>
                Try again
              </button>
            </>
          ) : error.kind === "invalid" ? (
            <p>Some figures could not be saved: {error.messages.join("; ")}. Your typing is kept.</p>
          ) : error.kind === "forbidden" ? (
            <p>
              Only the person who sent this photo can confirm its figures.{" "}
              <Link href={`/evidence/${trace.evidence.id}`} className="font-bold text-primary">
                Back to this record
              </Link>
            </p>
          ) : (
            <p>Could not confirm right now. Nothing was confirmed. Your typing is kept. Try again.</p>
          )}
        </div>
      ) : null}

      <table className="slip mt-4 w-full table-fixed border-separate border-spacing-0 overflow-hidden">
        <caption className="sr-only">Figures you are confirming</caption>
        <colgroup>
          {/* AI drafts carry a source label under each row label, so that column is wider. */}
          <col className={ai ? "w-[58%]" : "w-[45%]"} />
          <col />
          <col className="w-16" />
        </colgroup>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label}>
              <th
                scope="row"
                colSpan={r.stack ? 2 : undefined}
                className={`px-4 py-2 text-left font-normal ${i ? "border-t border-rule" : ""}`}
              >
                {r.label}
                {r.stack ? (
                  <span className="mt-0.5 block font-mono [overflow-wrap:anywhere]">{r.value}</span>
                ) : null}
                {r.demo ? (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm">
                    <DemoTag /> <span className="whitespace-nowrap">from demo file</span>
                  </span>
                ) : null}
                {r.source ?? null}
              </th>
              {r.stack ? null : (
                <td className={`px-2 py-2 text-right font-mono whitespace-nowrap ${i ? "border-t border-rule" : ""}`}>
                  {r.value}
                </td>
              )}
              <td className={`py-2 pr-2 text-right ${i ? "border-t border-rule" : ""}`}>
                <button
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center font-bold text-primary underline"
                  onClick={() => onEdit(r.key ?? undefined)}
                >
                  Edit<span className="sr-only"> {r.label}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {checks.length ? (
        <div className="mt-4">
          <h2 className="font-sans text-lg font-bold">Things to check</h2>
          <div className="mt-2">
            <Warnings warnings={checks} />
          </div>
        </div>
      ) : null}

      <label htmlFor={`${uid}-note`} className="mt-4 block font-bold">
        Anything a reviewer should know? (optional)
      </label>
      <textarea
        id={`${uid}-note`}
        rows={3}
        maxLength={1000}
        value={draft.note}
        onChange={(e) => update((d) => ({ ...d, note: e.target.value }))}
        className="field mt-2"
      />

      <p className="sr-only" aria-live="polite">
        {busy ? "Saving…" : ""}
      </p>
      <div className="mt-6 grid gap-2">
        {actions}
        {note}
      </div>
      {/* DEMO values stay labelled on every step. */}
      {draft.baseOrigin === "DEMO_FIXTURE" && latest.origin === "DEMO_FIXTURE" ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-demo">
          <DemoTag /> Values marked &ldquo;from demo file&rdquo; were not read from this photo.
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ 409 */

function StaleSlip({
  latest,
  draft,
  onKeep,
  onUse,
}: {
  latest: Revision;
  draft: Draft;
  onKeep: () => void;
  onUse: () => void;
}) {
  const diffs: string[] = [];
  for (const k of figureKeysFor(draft.parties)) {
    const theirs = figureValue(latest, k);
    const mine = fieldNumber(draft.fields[k]);
    if (theirs !== mine) {
      diffs.push(
        `${figureLabel(k)} ${theirs === null ? "unreadable" : theirs} (you typed ${mine === null ? (draft.fields[k].unreadable ? "unreadable" : "nothing") : mine})`,
      );
    }
  }
  const m = latest.revisionNumber;
  return (
    <div role="alert" className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-4">
      <p className="font-bold">
        A newer version (version <span className="font-mono">{m}</span>) was saved while you were working. Your typing
        is kept.
      </p>
      {diffs.length ? (
        <p className="mt-2">
          Version {m} has: <span className="font-mono">{diffs.join("; ")}</span>
        </p>
      ) : (
        <p className="mt-2">Version {m} has the same figures as your typing.</p>
      )}
      <div className="mt-3 grid gap-2 md:flex">
        <button type="button" className="btn btn-primary" onClick={onKeep}>
          Keep my figures
        </button>
        <button type="button" className="btn btn-secondary" onClick={onUse}>
          Use version {m} instead
        </button>
      </div>
    </div>
  );
}
