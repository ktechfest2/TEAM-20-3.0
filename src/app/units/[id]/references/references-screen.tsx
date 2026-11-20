"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { ArrowLeft, Ban, CircleCheck, Clock, ShieldCheck, ShieldQuestion, WifiOff } from "lucide-react";
import { ReferenceView } from "@/lib/contracts/verification";
import type { ReferenceType } from "@/lib/contracts";
import { electionForUnit, findPollingUnit, partyRosterFor } from "@/lib/seed/registry";
import { HistoricalTag } from "@/components/demo-band";
import { Stamp } from "@/components/stamp";
import { Choice } from "@/components/choice";
import { apiJson, issueMessages } from "@/components/client/api";
import { fmtTime, partyLabel } from "@/components/client/format";
import { useOnline } from "@/lib/offline/use-network";

const RefList = z.array(ReferenceView);
type Ref = ReferenceView;

const TYPE_LINE: Record<ReferenceType, string> = {
  SYNTHETIC_DEMO: "Sample reference (fictional)",
  MANUAL_IREV: "Typed in from a public IReV page",
  HISTORICAL_DATASET: "From a historical dataset",
};

type State =
  | { status: "loading" }
  | { status: "ready"; refs: Ref[] }
  | { status: "failed"; kind: "forbidden" | "notFound" | "offline" | "error" };

const sessionEndedLink = (unitId: string) => `/reviewer?next=${encodeURIComponent(`/units/${unitId}/references`)}`;

export function ReferencesScreen({ id }: { id: string }) {
  const unit = findPollingUnit(id);
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  // New version to focus once the refreshed list includes it.
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    const ctrl = new AbortController();
    apiJson(`/api/units/${encodeURIComponent(id)}/references?electionId=${electionForUnit(id)}`, RefList, {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (r.ok) setState({ status: "ready", refs: r.data });
        else if (r.kind === "http" && (r.status === 401 || r.status === 403))
          setState({ status: "failed", kind: "forbidden" });
        else if (r.kind === "http" && r.status === 404) setState({ status: "failed", kind: "notFound" });
        else if (r.kind === "network") setState({ status: "failed", kind: "offline" });
        else setState({ status: "failed", kind: "error" });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [id, unit, nonce]);

  // Refetch without dropping the list (forms keep their outcome messages).
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!focusId.current || state.status !== "ready") return;
    const el = document.getElementById(`ref-${focusId.current}-h`);
    if (el) {
      el.focus();
      focusId.current = null;
    }
  }, [state]);

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

  const back = (
    <Link href={`/units/${unit.id}`} className="inline-flex min-h-11 items-center gap-2 font-bold text-primary">
      <ArrowLeft aria-hidden size={20} />
      Comparison for <span className="font-mono">{unit.code}</span>
    </Link>
  );
  const heading = (
    <header>
      <h1 className="text-xl md:text-2xl">Reference records</h1>
      <p className="mt-1">
        <span className="font-mono">{unit.code}</span> {unit.name} {unit.synthetic ? null : <HistoricalTag />}
      </p>
    </header>
  );

  if (state.status === "failed" && state.kind === "forbidden") {
    return (
      <div className="mx-auto max-w-xl">
        {back}
        {heading}
        <h2 className="mt-6 text-xl">This page is for reviewers</h2>
        <p className="mt-2">Sign in with a reviewer account to see and add reference records.</p>
        <Link href={sessionEndedLink(unit.id)} className="btn btn-primary mt-4 w-full no-underline md:w-auto">
          Reviewer sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>{back}</div>
      {heading}
      <div className="grid gap-1 rounded-md bg-sunken p-4">
        <p>
          A reference record is a set of figures from another source, such as a public IReV page. It is compared with
          the reviewed witness photos.
        </p>
        <p>It is only used to confirm a difference after a second reviewer has checked where it came from.</p>
        <p>
          Records are kept permanently. A new version or a later review supersedes an earlier one but never erases it.
        </p>
      </div>

      {state.status === "loading" ? (
        <div aria-busy="true" className="grid gap-3">
          <p className="text-ink-muted">Loading reference records…</p>
          <div className="h-40 rounded-md bg-sunken" />
          <div className="h-40 rounded-md bg-sunken" />
        </div>
      ) : state.status === "failed" ? (
        <div className="max-w-xl">
          {state.kind === "offline" ? (
            <p className="flex items-start gap-3 rounded-md bg-sunken p-4">
              <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
              <span>You are offline. Reference records need a connection.</span>
            </p>
          ) : (
            <p role="alert">Reference records did not load.</p>
          )}
          <button
            type="button"
            className="btn btn-secondary mt-3"
            onClick={() => {
              setState({ status: "loading" });
              refresh();
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-12">
          <section aria-labelledby="versions-h" className="lg:col-span-7">
            <h2 id="versions-h" className="text-xl">
              Versions
            </h2>
            {state.refs.length === 0 ? (
              <p className="mt-2">No reference record for this polling unit yet.</p>
            ) : (
              <VersionList refs={state.refs} unitId={unit.id} onChanged={refresh} />
            )}
          </section>
          <section aria-labelledby="add-h" className="lg:col-span-5">
            <h2 id="add-h" className="text-xl">
              Add a reference record
            </h2>
            <AddReference
              unitId={unit.id}
              synthetic={unit.synthetic}
              startOpen={state.refs.length === 0}
              onAdded={(ref) => {
                focusId.current = ref.id;
                refresh();
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ versions */

/** Newest version first and actionable; older versions (not used in comparison) behind a disclosure. */
function VersionList({ refs, unitId, onChanged }: { refs: Ref[]; unitId: string; onChanged: () => void }) {
  const [newest, ...older] = [...refs].sort((a, b) => b.version - a.version);
  return (
    <div className="mt-3 grid gap-4">
      <VersionSlip reference={newest} newest unitId={unitId} onChanged={onChanged} />
      {older.length ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-bold text-primary">
            Show older versions (<span className="font-mono">{older.length}</span>)
          </summary>
          <ol className="mt-3 grid gap-4">
            {older.map((r) => (
              <li key={r.id}>
                <VersionSlip reference={r} newest={false} unitId={unitId} onChanged={onChanged} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ one version */

function ProvenanceStamp({ r }: { r: Ref }) {
  const latest = [...r.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!latest) return <Stamp label="Waiting for a second reviewer" icon={Clock} tone="local" />;
  return latest.decision === "SOURCE_CONFIRMED" ? (
    <Stamp label="Source confirmed by a second reviewer" icon={ShieldCheck} tone="tealOutline" />
  ) : (
    <Stamp label="Source not accepted" icon={ShieldQuestion} tone="outline" />
  );
}

function VersionSlip({
  reference: r,
  newest,
  unitId,
  onChanged,
}: {
  reference: Ref;
  newest: boolean;
  unitId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reviews = [...r.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <article id={`ref-${r.id}`} aria-labelledby={`ref-${r.id}-h`} className="slip scroll-mt-4">
      <div className="grid gap-1 px-4 py-3">
        <h3 id={`ref-${r.id}-h`} tabIndex={-1} className="font-mono text-lg font-semibold">
          Version {r.version}
        </h3>
        <p className="flex flex-wrap items-center gap-2">
          {TYPE_LINE[r.sourceType]}
        </p>
        <p className="text-sm text-ink-muted">
          {r.importedByViewer ? "Added by you" : "Added by another reviewer"} ·{" "}
          <span className="font-mono">{fmtTime(r.createdAt)}</span>
        </p>
        {newest ? null : <p className="text-sm font-bold">Older version, not used in comparison</p>}
      </div>
      <dl className="grid gap-2 px-4 py-3">
        <div>
          <dt className="slip-label">Description</dt>
          <dd>“{r.sourceDescription}”</dd>
        </div>
        {r.sourceUrl ? (
          <div>
            <dt className="slip-label">Source link (not opened by PollTrace)</dt>
            <dd className="font-mono break-words">{r.sourceUrl}</dd>
          </div>
        ) : null}
      </dl>
      <div className="px-4 py-3">
        <table className="w-full max-w-xs text-left">
          <caption className="slip-label text-left">Figures</caption>
          <tbody>
            {Object.entries(r.figures).map(([code, n]) => (
              <tr key={code} className="border-t border-rule">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {partyLabel(code)}
                </th>
                <td className="py-1 text-right font-mono">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 px-4 py-3">
        <div>
          <ProvenanceStamp r={r} />
        </div>
        {reviews.length ? (
          <ol className="grid gap-3">
            {reviews.map((rv, i) => (
              <li key={`${rv.createdAt}-${i}`} className="grid gap-1">
                <p className="font-bold">
                  {rv.decision === "SOURCE_CONFIRMED" ? "Source confirmed" : "Source not accepted"}
                </p>
                <blockquote className="italic">“{rv.reason}”</blockquote>
                <p className="text-sm text-ink-muted">
                  {rv.byViewer ? (
                    "By you"
                  ) : (
                    <>
                      Reviewer <span className="font-mono">{rv.reviewerRef}</span>
                    </>
                  )}{" "}
                  · <span className="font-mono">{fmtTime(rv.createdAt)}</span>
                </p>
                {i > 0 ? <p className="text-sm">Superseded by a later review (kept on record)</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      {/* Only the newest version is used in comparison, so only it can be checked here. */}
      {newest ? (
        <div className="px-4 py-3">
          {r.importedByViewer ? (
            <p className="flex items-start gap-3 rounded-md bg-sunken p-3">
              <Ban aria-hidden size={20} className="mt-0.5 shrink-0" />
              <span>You added this record, so you cannot check its source. Another reviewer must do it.</span>
            </p>
          ) : open ? (
            <SourceReview reference={r} unitId={unitId} onRecorded={onChanged} onCancel={() => setOpen(false)} />
          ) : (
            <button type="button" className="btn btn-secondary w-full md:w-auto" onClick={() => setOpen(true)}>
              Check this source
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------ source review */

type Decision = "SOURCE_CONFIRMED" | "SOURCE_REJECTED";
type Outcome =
  | { kind: "none" }
  | { kind: "recorded"; at: string }
  | { kind: "selfReview" }
  | { kind: "sessionEnded" }
  | { kind: "invalid"; message: string }
  | { kind: "network" };

function SourceReview({
  reference: r,
  unitId,
  onRecorded,
  onCancel,
}: {
  reference: Ref;
  unitId: string;
  onRecorded: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const online = useOnline();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ decision?: string; reason?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  if (outcome.kind === "recorded") {
    return (
      <p role="status" className="flex items-start gap-3 rounded-md bg-success-tint p-3">
        <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
        <span>
          Source check recorded at <span className="font-mono">{fmtTime(outcome.at)}</span>. The comparison for this
          polling unit now uses it.
        </span>
      </p>
    );
  }
  if (outcome.kind === "selfReview") {
    return (
      <p role="alert" className="flex items-start gap-3 rounded-md bg-sunken p-3">
        <Ban aria-hidden size={20} className="mt-0.5 shrink-0" />
        <span>
          You added this record, so you cannot check its source. Another reviewer must do it. Nothing was recorded.
        </span>
      </p>
    );
  }

  const validate = () => {
    const next: typeof errors = {};
    if (!decision) next.decision = "Choose whether the source is believable.";
    if (reason.trim().length < 3) next.reason = "Write a short reason. A few words are enough.";
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return false;
    }
    return true;
  };

  async function record() {
    if (!decision) return;
    setBusy(true);
    const res = await apiJson(`/api/references/${r.id}/review`, ReferenceView, {
      method: "POST",
      body: { decision, reason: reason.trim() },
    });
    setBusy(false);
    if (res.ok) {
      const mine = [...res.data.reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
      setOutcome({ kind: "recorded", at: mine?.createdAt ?? new Date().toISOString() });
      onRecorded();
      return;
    }
    if (res.kind === "network") return setOutcome({ kind: "network" });
    if (res.kind === "http" && res.code === "SELF_REVIEW") return setOutcome({ kind: "selfReview" });
    if (res.kind === "http" && (res.status === 401 || res.status === 403)) return setOutcome({ kind: "sessionEnded" });
    const msgs = res.kind === "http" ? issueMessages(res.body) : [];
    setOutcome({
      kind: "invalid",
      message: msgs.join("; ") || (res.kind === "http" && res.message) || "the server did not accept it",
    });
  }

  const errorList = Object.values(errors).filter(Boolean);
  return (
    <div className="grid gap-4">
      {errorList.length ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border-2 border-caution bg-caution-tint p-3"
        >
          <p className="font-bold">Before you continue:</p>
          <ul className="list-disc pl-5">
            {errorList.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <fieldset disabled={confirming}>
        <legend className="text-lg font-bold">Is the source of this record believable?</legend>
        <p className="mt-1 text-sm">
          You are checking where the figures came from, not whether they are the true result.
        </p>
        <div className="mt-2 grid gap-2">
          <Choice
            name={`${uid}-d`}
            checked={decision === "SOURCE_CONFIRMED"}
            onChange={() => setDecision("SOURCE_CONFIRMED")}
            title="Confirm the source"
            text="You checked where this record came from and the description matches it."
          />
          <Choice
            name={`${uid}-d`}
            checked={decision === "SOURCE_REJECTED"}
            onChange={() => setDecision("SOURCE_REJECTED")}
            title="Do not accept the source"
            text="The source is missing, unclear, or does not match the figures."
          />
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${uid}-reason`} className="text-lg font-bold">
          Reason
        </label>
        <p id={`${uid}-hint`} className="text-sm text-ink-muted">
          Say how you checked the source.
        </p>
        <textarea
          id={`${uid}-reason`}
          rows={3}
          maxLength={2000}
          value={reason}
          readOnly={confirming}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={`${uid}-hint ${uid}-count`}
          className={`field mt-2 ${errors.reason ? "border-2 border-caution" : ""}`}
        />
        <p id={`${uid}-count`} className="text-right font-mono text-xs text-ink-muted">
          {reason.length} / 2000
        </p>
        {errors.reason ? <p className="text-caution">{errors.reason}</p> : null}
      </div>

      {!confirming ? (
        <div className="flex flex-col gap-2 md:flex-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (validate()) {
                setConfirming(true);
                setOutcome({ kind: "none" });
                requestAnimationFrame(() => confirmRef.current?.focus());
              }
            }}
          >
            Continue to confirm
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="rounded-md border-2 border-caution bg-caution-tint p-4">
          <h4 ref={confirmRef} tabIndex={-1} className="text-lg font-bold">
            Record this source check?
          </h4>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="inline font-bold">Decision: </dt>
              <dd className="inline">
                {decision === "SOURCE_CONFIRMED" ? "Confirm the source" : "Do not accept the source"}
              </dd>
            </div>
            <div>
              <dt className="inline font-bold">Reason: </dt>
              <dd className="inline">“{reason.trim()}”</dd>
            </div>
          </dl>
          <p className="mt-3 font-bold">
            This check is kept permanently. A later check can supersede it but not erase it.
          </p>
          {outcome.kind === "network" ? (
            <p role="alert" className="mt-3">
              Could not reach the server. Nothing was recorded. Your choices are kept. Try again.
            </p>
          ) : outcome.kind === "invalid" ? (
            <p role="alert" className="mt-3">
              This check could not be recorded: {outcome.message}. Nothing was saved.
            </p>
          ) : outcome.kind === "sessionEnded" ? (
            <p role="alert" className="mt-3">
              Your reviewer session has ended. Nothing was recorded.{" "}
              <Link href={sessionEndedLink(unitId)} className="font-bold text-primary">
                Sign in again to continue.
              </Link>
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <button type="button" className="btn btn-primary" disabled={busy || !online} onClick={() => void record()}>
              {busy ? "Recording…" : "Record check"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Go back and change
            </button>
          </div>
          {!online ? <p className="mt-2 text-sm">Needs a connection</p> : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ add a reference */

const DIGITS = /^[0-9]+$/;
/** Form fields: the fixed ones plus one per party code of this unit's election. */
type FieldKey = string;

function AddReference({
  unitId,
  synthetic,
  startOpen,
  onAdded,
}: {
  unitId: string;
  synthetic: boolean;
  startOpen: boolean;
  onAdded: (ref: Ref) => void;
}) {
  const electionId = electionForUnit(unitId);
  const roster = partyRosterFor(electionId);
  const uid = useId();
  const online = useOnline();
  const [open, setOpen] = useState(startOpen);
  const [type, setType] = useState<ReferenceType | null>(synthetic ? "SYNTHETIC_DEMO" : null);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [figures, setFigures] = useState<Record<string, string>>(Object.fromEntries(roster.map((p) => [p, ""])));
  const [markedSynthetic, setMarkedSynthetic] = useState(synthetic);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ version: number; at: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const forcedSynthetic = synthetic || type === "SYNTHETIC_DEMO";
  const isSynthetic = forcedSynthetic || markedSynthetic;
  const fid = (k: FieldKey) => `${uid}-${k}`;
  const hasTyping = Boolean(description.trim() || url.trim() || roster.some((p) => figures[p].trim()));
  const discard = () => {
    setDescription("");
    setUrl("");
    setFigures(Object.fromEntries(roster.map((p) => [p, ""])));
    setErrors({});
    setServerError(null);
  };

  const validate = () => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!type) e.type = "Choose where these figures are from.";
    if (description.trim().length < 3) e.description = "Describe the source in a few words.";
    const u = url.trim();
    if (u && !(/^https:\/\/\S+$/.test(u) && URL.canParse(u)))
      e.url = "Enter a full link starting with https://, or leave it empty.";
    for (const p of roster)
      if (!DIGITS.test(figures[p].trim())) e[p] = `${partyLabel(p)}: type the figure from the source.`;
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return false;
    }
    return true;
  };

  async function submit() {
    if (!type) return;
    setBusy(true);
    setServerError(null);
    const res = await apiJson("/api/references", ReferenceView, {
      method: "POST",
      body: {
        electionId,
        pollingUnitId: unitId,
        sourceType: type,
        sourceDescription: description.trim(),
        ...(url.trim() ? { sourceUrl: url.trim() } : {}),
        figures: Object.fromEntries(roster.map((p) => [p, Number(figures[p].trim())])),
        synthetic: isSynthetic,
      },
    });
    setBusy(false);
    if (res.ok) {
      setAdded({ version: res.data.version, at: res.data.createdAt });
      setOpen(false);
      setConfirming(false);
      setDescription("");
      setUrl("");
      setFigures(Object.fromEntries(roster.map((p) => [p, ""])));
      onAdded(res.data);
      return;
    }
    setConfirming(false);
    if (res.kind === "network")
      setServerError("Could not reach the server. Nothing was recorded. Your typing is kept. Try again.");
    else if (res.kind === "http" && (res.status === 401 || res.status === 403)) setServerError("SESSION");
    else if (res.kind === "http" && res.code === "INVALID_SOURCE_URL")
      setErrors({ url: "Enter a full link starting with https://, or leave it empty." });
    else if (res.kind === "http" && res.code === "REFERENCE_VERSION_CONFLICT")
      setServerError("Another reference was being saved at the same time. Nothing was recorded. Try again.");
    else {
      const msgs = res.kind === "http" ? issueMessages(res.body) : [];
      setServerError(
        `This record could not be added: ${msgs.join("; ") || (res.kind === "http" && res.message) || "the server did not accept it"}. Your typing is kept.`,
      );
    }
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  const errorList = Object.entries(errors).filter(([, m]) => m) as Array<[FieldKey, string]>;

  return (
    <div className="mt-3 grid gap-4">
      {added ? (
        <p role="status" className="flex items-start gap-3 rounded-md bg-success-tint p-3">
          <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
          <span>
            Reference version <span className="font-mono">{added.version}</span> added at{" "}
            <span className="font-mono">{fmtTime(added.at)}</span>. It is waiting for a second reviewer to check its
            source.
          </span>
        </p>
      ) : null}
      {!open ? (
        hasTyping ? (
          <div className="grid gap-2 rounded-md bg-sunken p-3">
            <p>You have a version in progress. What you typed is kept on this page.</p>
            <div className="flex flex-col gap-2 md:flex-row">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
                Continue the new version
              </button>
              <button type="button" className="btn btn-secondary" onClick={discard}>
                Discard what you typed
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-secondary w-full md:w-auto"
            onClick={() => {
              setOpen(true);
              setAdded(null);
            }}
          >
            Add a new version
          </button>
        )
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="grid gap-5"
        >
          {errorList.length || serverError ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-md border-2 border-caution bg-caution-tint p-3"
            >
              {serverError === "SESSION" ? (
                <p>
                  Your reviewer session has ended. Nothing was recorded.{" "}
                  <Link href={sessionEndedLink(unitId)} className="font-bold text-primary">
                    Sign in again to continue.
                  </Link>
                </p>
              ) : serverError ? (
                <p>{serverError}</p>
              ) : null}
              {errorList.length ? (
                <>
                  <p className="font-bold">Before you continue:</p>
                  <ul className="list-disc pl-5">
                    {errorList.map(([k, m]) => (
                      <li key={k}>
                        <a href={`#${fid(k)}`} className="text-ink">
                          {m}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          <fieldset id={fid("type")} disabled={confirming}>
            <legend className="text-lg font-bold">Where are these figures from?</legend>
            {synthetic ? (
              <p className="mt-1 text-sm">This is a sample polling unit, so only a sample reference can be added.</p>
            ) : null}
            <div className="mt-2 grid gap-2">
              {!synthetic ? (
                <>
                  <Choice
                    name={`${uid}-type`}
                    checked={type === "MANUAL_IREV"}
                    onChange={() => setType("MANUAL_IREV")}
                    title="A public IReV page"
                    text="You typed the figures from a public IReV result page."
                  />
                  <Choice
                    name={`${uid}-type`}
                    checked={type === "HISTORICAL_DATASET"}
                    onChange={() => setType("HISTORICAL_DATASET")}
                    title="A historical dataset"
                    text="Figures from a published dataset whose licence allows this use."
                  />
                </>
              ) : null}
              <Choice
                name={`${uid}-type`}
                checked={type === "SYNTHETIC_DEMO"}
                onChange={() => setType("SYNTHETIC_DEMO")}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Sample reference
                  </span>
                }
                text="Made-up figures for testing. Not real."
              />
            </div>
          </fieldset>

          <div>
            <label htmlFor={fid("description")} className="text-lg font-bold">
              Describe the source
            </label>
            <p id={`${fid("description")}-hint`} className="text-sm text-ink-muted">
              Say exactly where you got the figures, for example the page title and the date you viewed it.
            </p>
            <textarea
              id={fid("description")}
              rows={3}
              maxLength={1000}
              value={description}
              readOnly={confirming}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={`${fid("description")}-hint`}
              aria-invalid={errors.description ? true : undefined}
              className={`field mt-2 ${errors.description ? "border-2 border-caution" : ""}`}
            />
          </div>

          <div>
            <label htmlFor={fid("url")} className="text-lg font-bold">
              Source link (optional)
            </label>
            <p id={`${fid("url")}-hint`} className="text-sm text-ink-muted">
              Shown as text only. PollTrace does not open or check this link.
            </p>
            <input
              id={fid("url")}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              readOnly={confirming}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby={`${fid("url")}-hint`}
              aria-invalid={errors.url ? true : undefined}
              className={`field mt-2 font-mono ${errors.url ? "border-2 border-caution" : ""}`}
            />
            {errors.url ? <p className="mt-1 text-caution">{errors.url}</p> : null}
          </div>

          <fieldset className="slip [&>p:first-of-type]:border-t-0" disabled={confirming}>
            <legend className="sr-only">Figures from the source</legend>
            <p aria-hidden className="px-4 pt-3 text-lg font-bold">
              Figures from the source
            </p>
            {roster.map((p) => (
              <div key={p} className="px-4 py-3">
                <label htmlFor={fid(p)} className="flex flex-wrap items-center gap-2 font-bold">
                  {partyLabel(p)} <span className="font-mono text-xs font-normal text-ink-muted">{p}</span>
                </label>
                <input
                  id={fid(p)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={figures[p]}
                  onChange={(e) => setFigures((f) => ({ ...f, [p]: e.target.value }))}
                  aria-invalid={errors[p] ? true : undefined}
                  className={`field mt-1 w-36 text-right font-mono ${errors[p] ? "border-2 border-caution" : ""}`}
                />
                {errors[p] ? <p className="mt-1 text-caution">Type the figure from the source.</p> : null}
              </div>
            ))}
          </fieldset>

          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              checked={isSynthetic}
              disabled={forcedSynthetic || confirming}
              onChange={(e) => setMarkedSynthetic(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <span>
              <span className="font-bold">These are sample (fictional) figures</span>
              {synthetic ? <span className="block text-sm">Required: this is a sample polling unit.</span> : null}
            </span>
          </label>

          {!confirming ? (
            <div className="flex flex-col gap-2 md:flex-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setServerError(null);
                  if (validate()) {
                    setConfirming(true);
                    requestAnimationFrame(() => confirmRef.current?.focus());
                  }
                }}
              >
                Continue to confirm
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Close (keeps what you typed)
              </button>
            </div>
          ) : (
            <div className="rounded-md border-2 border-caution bg-caution-tint p-4">
              <h3 ref={confirmRef} tabIndex={-1} className="text-lg font-bold">
                Add this reference record?
              </h3>
              <dl className="mt-2 grid gap-1">
                <div>
                  <dt className="inline font-bold">Type: </dt>
                  <dd className="inline">{type ? TYPE_LINE[type] : ""}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Description: </dt>
                  <dd className="inline">“{description.trim()}”</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Link: </dt>
                  <dd className="inline font-mono break-words">{url.trim() || "None"}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Figures: </dt>
                  <dd className="inline font-mono">
                    {roster.map((p) => `${partyLabel(p)} ${figures[p].trim()}`).join(" · ")}
                  </dd>
                </div>
                {isSynthetic ? (
                  <div>
                    <dt className="inline font-bold">Data: </dt>
                    <dd className="inline">
                      Sample (fictional)
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-3 font-bold">
                This record is kept permanently. A later version can supersede it but not erase it. It is only used to
                confirm a difference after a different reviewer checks its source.
              </p>
              <div className="mt-4 flex flex-col gap-2 md:flex-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !online}
                  onClick={() => void submit()}
                >
                  {busy ? "Adding…" : "Add record"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Go back and change
                </button>
              </div>
              {!online ? <p className="mt-2 text-sm">Needs a connection</p> : null}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
