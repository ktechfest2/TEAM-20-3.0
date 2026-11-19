"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, FlaskConical, Info, TriangleAlert, WifiOff } from "lucide-react";
import {
  EvidenceTrace,
  ExtractResponse,
  ResultRevisionView,
  type ResultRevisionView as Revision,
} from "@/lib/contracts/trace";
import type { ExtractionMode, FormType } from "@/lib/contracts";
import { PARTY_ROSTER } from "@/lib/seed/registry";
import { ActionBar } from "@/components/action-bar";
import { DemoTag } from "@/components/demo-band";
import { apiJson, issueMessages } from "@/components/client/api";
import { figureLabel, figureValue, FIGURE_KEYS, FORM_TYPE_LABEL, Unreadable, Warnings, type FigureKey } from "@/components/evidence/figures";
import { OriginalPhoto } from "@/components/evidence/original-photo";
import { latestRevisionOf, useTrace } from "@/components/evidence/use-trace";
import { useOnline } from "@/lib/offline/use-network";
import {
  blockingProblems,
  clearDraft,
  consistencyChecks,
  DIGITS,
  draftFromRevision,
  fieldNumber,
  loadDraft,
  saveDraft,
  toConfirmRequest,
  type Draft,
  type FieldDraft,
  type Problem,
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
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const [extracted, setExtracted] = useState<Revision | null>(null);
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
        setDraft(draftFromRevision(latest, null));
      }
    }
  }

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      setDraft((d) => {
        if (!d) return d;
        const next = fn(d);
        setStorageWarning(!saveDraft(id, next));
        return next;
      });
    },
    [id],
  );

  const go = (s: Step, hash = "") => router.push(`/evidence/${id}/figures?step=${s}${hash}`);

  const onExtracted = (res: ExtractResponse) => {
    const d = draftFromRevision(res.revision, res.notice);
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

  if (step === "mode") {
    return (
      <div className="mx-auto max-w-xl pt-2">
        {backLink}
        <ModeStep trace={trace} online={online} onExtracted={onExtracted} />
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
    const d = draftFromRevision(m, null);
    saveDraft(id, d);
    setDraft(d);
    setStale(null);
    go("enter");
  };

  return (
    <div className="grid gap-x-8 lg:grid-cols-12">
      <div className="lg:col-span-12">{backLink}</div>
      <div className="lg:col-span-7">
        <PhotoPanel src={trace.originalUrl} synthetic={trace.evidence.synthetic} code={trace.evidence.pollingUnitCode} />
      </div>
      <div className="lg:col-span-5">
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

function ModeStep({
  trace,
  online,
  onExtracted,
}: {
  trace: EvidenceTrace;
  online: boolean;
  onExtracted: (r: ExtractResponse) => void;
}) {
  // REAL_VISION is never offered in this version, even if a server lists it.
  const modes = trace.permissions.availableExtractionModes.filter((m): m is Exclude<ExtractionMode, "REAL_VISION"> => m !== "REAL_VISION");
  const manualOnly = !modes.includes("DEMO_FIXTURE");
  const [choice, setChoice] = useState<ExtractionMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"unavailable" | "network" | "other" | "choose" | null>(null);
  const uid = useId();

  async function start(mode: ExtractionMode) {
    setBusy(true);
    setError(null);
    const r = await apiJson(`/api/evidence/${trace.evidence.id}/extract`, ExtractResponse, { method: "POST", body: { mode } });
    setBusy(false);
    if (r.ok) return onExtracted(r.data);
    if (r.kind === "network") return setError("network");
    if (r.kind === "http" && r.code === "MODE_UNAVAILABLE") return setError("unavailable");
    setError("other");
  }

  const actions = manualOnly ? (
    <button type="button" className="btn btn-primary w-full" disabled={busy || !online} onClick={() => void start("MANUAL")}>
      {busy ? "Preparing the form…" : "Start typing"}
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-primary w-full"
      disabled={busy || !online}
      onClick={() => (choice ? void start(choice) : setError("choose"))}
    >
      {busy ? "Preparing the form…" : "Continue"}
    </button>
  );
  const note = !online ? <p className="text-sm">Needs a connection</p> : undefined;

  return (
    <section aria-labelledby={`${uid}-h`} className="pt-2">
      <h1 id={`${uid}-h`} className="text-xl md:text-2xl">
        Enter the figures
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 1 of 3</p>

      <div className="mt-4 flex items-center gap-3">
        <OriginalPhoto
          src={trace.originalUrl}
          synthetic={false}
          alt={`Original photo for ${trace.evidence.pollingUnitCode}`}
          className="h-24 w-20 shrink-0 overflow-hidden rounded-md border border-rule bg-sunken"
          imgClassName="h-24 w-20 object-cover"
        />
        <p>
          <span className="font-mono font-semibold">{trace.evidence.pollingUnitCode}</span>{" "}
          {trace.evidence.synthetic ? <DemoTag /> : null}
          <span className="block">{trace.evidence.pollingUnitName}</span>
        </p>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-md bg-sunken p-3">
        <Info aria-hidden size={20} className="mt-0.5 shrink-0" />
        <span>Automatic reading is not available in this version. Figures are typed in by a person.</span>
      </p>

      {manualOnly ? null : (
        <fieldset className="mt-4" aria-describedby={error === "choose" ? `${uid}-err` : undefined}>
          <legend className="text-lg font-bold">How do you want to enter the figures?</legend>
          {error === "choose" ? (
            <p id={`${uid}-err`} className="mt-1 text-caution">
              Choose one to continue.
            </p>
          ) : null}
          <div className="mt-2 grid gap-2">
            {modes.includes("MANUAL") ? (
              <Radio name={`${uid}-mode`} checked={choice === "MANUAL"} onChange={() => setChoice("MANUAL")}>
                <span className="block font-bold">Type the figures yourself</span>
                <span className="block text-sm">You read the photo and type each number.</span>
              </Radio>
            ) : null}
            <Radio name={`${uid}-mode`} checked={choice === "DEMO_FIXTURE"} onChange={() => setChoice("DEMO_FIXTURE")}>
              <span className="flex flex-wrap items-center gap-2 font-bold">
                Load demo figures <DemoTag />
              </span>
              <span className="block text-sm">
                Demo figures — not read from this photo. For the synthetic demo only. You must still check each one.
              </span>
            </Radio>
          </div>
        </fieldset>
      )}

      <div aria-live="polite" className="mt-3">
        {busy ? <p>Preparing the form…</p> : null}
        {error === "unavailable" ? (
          <div role="alert" className="rounded-md border-2 border-caution bg-caution-tint p-3">
            <p>That option is not available right now. You can type the figures yourself.</p>
            <button type="button" className="btn btn-secondary mt-2" onClick={() => void start("MANUAL")}>
              Type them myself
            </button>
          </div>
        ) : error === "network" ? (
          <p role="alert">Could not reach the server. Nothing was changed. Try again.</p>
        ) : error === "other" ? (
          <p role="alert">Could not start. Try again.</p>
        ) : null}
      </div>

      <div className="md:hidden">
        <ActionBar note={note}>{actions}</ActionBar>
      </div>
      <div className="mt-6 hidden max-w-sm md:block">
        {actions}
        {note}
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

function SourceNotice({ draft, latest }: { draft: Draft; latest: Revision }) {
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
        Type the figures
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
            <fieldset>
              <legend className="font-bold">Form type</legend>
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
                      onChange={() => update((d) => ({ ...d, formType: ft }))}
                      className="size-5 accent-primary"
                    />
                    {FORM_TYPE_LABEL[ft]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={`${uid}-code`} className="mt-4 block font-bold">
              Polling unit code on the sheet
            </label>
            <p id={`${uid}-code-hint`} className="text-sm text-ink-muted">
              Type it exactly as written. Leave blank if you can&rsquo;t read it.
            </p>
            <input
              id={`${uid}-code`}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={draft.code}
              onChange={(e) => update((d) => ({ ...d, code: e.target.value }))}
              aria-describedby={`${uid}-code-hint`}
              className="field mt-2 font-mono"
            />
          </div>
        </fieldset>

        <fieldset className="slip [&>p:first-of-type]:border-t-0">
          <legend className="sr-only">Votes for each party</legend>
          <p aria-hidden className="px-4 pt-3 text-lg font-bold">
            Votes for each party
          </p>
          {PARTY_ROSTER.map((k) => (
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
        />
      </form>

      <div className="md:hidden">
        <ActionBar>{actions}</ActionBar>
      </div>
      <div className="mt-6 hidden gap-2 md:grid">{actions}</div>
    </section>
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
  const describedBy = [
    showCode ? `${id}-code` : null,
    invalid ? `${id}-err` : null,
    field.unreadable ? `${id}-unread` : null,
    field.flagged && !field.unreadable ? `${id}-flag` : null,
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
      </div>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={field.unreadable ? "" : field.value}
        disabled={field.unreadable}
        onChange={(e) => setField(k, { value: e.target.value, fromDemo: false, flagged: field.flagged })}
        onBlur={() => setTouched(true)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`field mt-1 w-36 text-right font-mono ${
          invalid || (field.flagged && !field.unreadable) ? "border-2 border-caution" : ""
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
          onChange={(e) => setField(k, { unreadable: e.target.checked, fromDemo: false })}
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
}: {
  checks: string[];
  blocking: Problem[];
  serverWarnings: string[];
  version: number;
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
      <div aria-live="polite">
        <Warnings warnings={checks} />
      </div>
      <Warnings warnings={serverWarnings} heading={`Noted by the server when version ${version} was saved:`} />
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
  onEdit: (k?: FigureKey) => void;
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

  const rows: Array<{ key: FigureKey | null; label: string; value: ReactNode; demo: boolean }> = [
    { key: null, label: "Form type", value: FORM_TYPE_LABEL[draft.formType], demo: false },
    {
      key: null,
      label: "Code on sheet",
      value: draft.code.trim() || <span className="font-sans text-ink-muted">Not given</span>,
      demo: false,
    },
    ...FIGURE_KEYS.map((k) => {
      const n = fieldNumber(draft.fields[k]);
      return { key: k, label: figureLabel(k), value: n === null ? <Unreadable /> : n, demo: draft.fields[k].fromDemo };
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
          <col className="w-[45%]" />
          <col />
          <col className="w-16" />
        </colgroup>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label}>
              <th scope="row" className={`px-4 py-2 text-left font-normal ${i ? "border-t border-rule" : ""}`}>
                {r.label}
                {r.demo ? (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm">
                    <DemoTag /> <span className="whitespace-nowrap">from demo file</span>
                  </span>
                ) : null}
              </th>
              <td className={`px-2 py-2 text-right font-mono break-all ${i ? "border-t border-rule" : ""}`}>{r.value}</td>
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
      <div className="md:hidden">
        <ActionBar note={note}>{actions}</ActionBar>
      </div>
      <div className="mt-6 hidden gap-2 md:grid">
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
  for (const k of FIGURE_KEYS) {
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
