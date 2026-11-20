"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CircleCheck, Clock, Download, FlaskConical, Lock, RotateCcw, TriangleAlert, WifiOff } from "lucide-react";
import { DEMO_UNIT_ID, DemoState, type DemoStageId } from "@/lib/contracts/demo";
import { DemoTag } from "@/components/demo-band";
import { Stamp } from "@/components/stamp";
import { apiJson } from "@/components/client/api";
import { STATUS_META } from "@/components/units/labels";
import { useOnline } from "@/lib/offline/use-network";

/**
 * Presenter's guide for the 3-minute demo. It links into the real screens and triggers the real
 * server-side demo stages; it never shows a simulated result. Everything it shows comes from
 * GET /api/demo or a stage/reset response.
 */

const UNIT_CODE = "DEMO.00.00.012";
const PASS_KEY = "polltrace:demo-passcode"; // sessionStorage: this tab only, never sent anywhere else

type StageInfo = { title: string; runs: ReactNode; button: string };

const STAGES: Record<DemoStageId, StageInfo> = {
  WITNESSES: {
    title: "Independent witnesses submit matching evidence",
    button: "Run: two witnesses submit",
    runs: (
      <>
        Runs the real upload (the server makes its own fingerprint), loads demo figures and confirms them, as{" "}
        <strong>Synthetic Demo Witness 1</strong> and <strong>Synthetic Demo Witness 2</strong>. Each sends a
        different synthetic sheet and confirms Party A 145, Party B 210, Party C 42.
      </>
    ),
  },
  DUPLICATE: {
    title: "A duplicate is identified and excluded",
    button: "Run: a copy is sent",
    runs: (
      <>
        Runs the real upload as <strong>Synthetic Demo Witness 3</strong>, sending Witness 1&rsquo;s exact file.
        The fingerprints match, so the copy is counted once, never as an extra witness.
      </>
    ),
  },
  REVIEWS: {
    title: "A reviewer checks the evidence and its independence",
    button: "Run: reviewer decides",
    runs: (
      <>
        Runs the real review service as <strong>Synthetic Demo Reviewer A</strong>: accepts all three photos,
        judges Witness 1 and Witness 2 independent, and leaves the copy from Witness 3 as &ldquo;not assessed&rdquo;.
      </>
    ),
  },
  REFERENCE: {
    title: "A reviewed reference record differs by 60",
    button: "Run: reference added and checked",
    runs: (
      <>
        Runs the real reference import as <strong>Synthetic Demo Reviewer B</strong> (synthetic reference: Party A
        145, Party B 270, Party C 42), then the real source check as <strong>Synthetic Demo Reviewer A</strong>, a
        different reviewer.
      </>
    ),
  },
};
const ORDER: DemoStageId[] = ["WITNESSES", "DUPLICATE", "REVIEWS", "REFERENCE"];

type Load = { status: "loading" } | { status: "ready"; demo: DemoState } | { status: "failed"; kind: "offline" | "error" };
type Failure = { stage: DemoStageId | "RESET"; message: string; passcode?: boolean };

function readPass(): string {
  try {
    return sessionStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function DemoGuide() {
  const online = useOnline();
  const uid = useId();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  // Restored within this tab only (sessionStorage: not shared with other tabs, gone when the tab closes).
  // The input renders only after the client has loaded the demo state, so there is no hydration mismatch.
  const [passcode, setPasscode] = useState(() => (typeof window === "undefined" ? "" : readPass()));
  const [busy, setBusy] = useState<DemoStageId | "RESET" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [ranThisSession, setRan] = useState<Partial<Record<DemoStageId, DemoState["verificationStatus"]>>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiJson("/api/demo", DemoState, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) setLoad({ status: "ready", demo: r.data });
        else setLoad({ status: "failed", kind: r.kind === "network" ? "offline" : "error" });
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  async function call(target: DemoStageId | "RESET") {
    if (!passcode.trim()) {
      setFailure({ stage: target, message: "Enter the demo passcode first.", passcode: true });
      passRef.current?.focus();
      return;
    }
    setBusy(target);
    setFailure(null);
    setResetDone(null);
    const path = target === "RESET" ? "/api/demo/reset" : `/api/demo/stages/${target}`;
    const r = await apiJson(path, DemoState, { method: "POST", body: { passcode: passcode.trim() } });
    setBusy(null);
    if (r.ok) {
      setLoad({ status: "ready", demo: r.data });
      if (target === "RESET") {
        setRan({});
        setConfirmReset(false);
        setResetDone(r.data.verificationStatus);
      } else setRan((m) => ({ ...m, [target]: r.data.verificationStatus }));
      return;
    }
    let message = "This step did not finish. Nothing new is shown as done. Try again.";
    let isPass = false;
    if (r.kind === "network") message = "Could not reach the server. Nothing was run. Try again.";
    else if (r.kind === "http") {
      if (r.code === "DEMO_PASSCODE_INVALID" || r.status === 401) {
        message = "That passcode is not right. Nothing was run.";
        isPass = true;
      } else if (r.code === "DEMO_DISABLED") message = "Demo mode is not set up on this server.";
      else if (r.code === "DEMO_STAGE_ORDER") message = "Run the earlier steps first. The list below has been refreshed.";
      else if (r.status === 429) message = "Too many attempts. Wait a minute, then try again.";
      else if (r.status === 404) message = "This demo step is not available on this server.";
    }
    setFailure({ stage: target, message, passcode: isPass });
    if (isPass) passRef.current?.focus();
    refetch();
  }

  const header = (
    <header>
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-bold text-primary">
        <ArrowLeft aria-hidden size={20} />
        Back to PollTrace
      </Link>
      <h1 className="mt-2 text-xl md:text-2xl">Guided demo</h1>
      <p className="mt-2">
        One story in eight steps, about three minutes. Each step opens a real PollTrace screen or runs the real
        services as a synthetic demo actor. Nothing here is a mock-up.
      </p>
      <div className="mt-4 flex items-start gap-2 rounded-md border-2 border-dashed border-demo bg-demo-tint p-3 text-demo">
        <FlaskConical aria-hidden size={20} className="mt-0.5 shrink-0" />
        <p>
          <strong>All data on this page is synthetic.</strong> The polling unit {UNIT_CODE}, the witnesses, the
          reviewers and every figure are made up for the demo. They are not real people or real results.
        </p>
      </div>
    </header>
  );

  if (load.status === "loading") {
    return (
      <div className="grid gap-4">
        {header}
        <p aria-busy="true" className="text-ink-muted">
          Loading the demo…
        </p>
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <div className="grid gap-4">
        {header}
        {load.kind === "offline" || !online ? (
          <p className="flex items-start gap-3 rounded-md bg-sunken p-4">
            <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>You are offline. The demo needs a connection.</span>
          </p>
        ) : (
          <p role="alert">The demo did not load.</p>
        )}
        <button
          type="button"
          className="btn btn-secondary w-full md:w-auto"
          onClick={() => {
            setLoad({ status: "loading" });
            refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const demo = load.demo;
  const done = (id: DemoStageId) => demo.stages.find((s) => s.id === id)?.done ?? false;
  const summary = (id: DemoStageId) => demo.stages.find((s) => s.id === id)?.summary ?? "";
  const doneCount = ORDER.filter(done).length;
  const statusMeta = STATUS_META[demo.verificationStatus];
  const disabled = !demo.enabled;

  const stageCard = (id: DemoStageId) => {
    const i = ORDER.indexOf(id);
    const prev = i > 0 ? ORDER[i - 1] : null;
    const isDone = done(id);
    const blockedBy = prev && !done(prev) ? prev : null;
    const reason = disabled
      ? "Demo mode is not set up on this server."
      : !online
        ? "Needs a connection."
        : blockedBy
          ? `Run step ${ORDER.indexOf(blockedBy) + 4} first: ${STAGES[blockedBy].title.toLowerCase()}.`
          : null;
    const fail = failure?.stage === id ? failure : null;
    return (
      <div className="mt-3 grid gap-3 rounded-md border border-rule bg-surface p-4">
        <p className="text-sm">
          <span className="font-bold">What it runs: </span>
          {STAGES[id].runs}
        </p>
        <div>
          {isDone ? (
            <Stamp small label="Done" icon={CircleCheck} tone="done" />
          ) : blockedBy ? (
            <Stamp small label="Waiting for the step before" icon={Clock} tone="outline" />
          ) : (
            <Stamp small label="Ready to run" icon={Clock} tone="local" />
          )}
        </div>
        {isDone ? (
          <StageResult id={id} demo={demo} statusAfterRun={ranThisSession[id] ?? null} summary={summary(id)} />
        ) : (
          <div>
            <button
              type="button"
              className="btn btn-primary w-full md:w-auto"
              disabled={reason !== null || busy !== null}
              onClick={() => void call(id)}
            >
              {busy === id ? "Running…" : STAGES[id].button}
            </button>
            {reason ? <p className="mt-1 text-sm">{reason}</p> : null}
            {busy === id ? (
              <p role="status" className="mt-1 text-sm">
                Running the real services. This can take a few seconds.
              </p>
            ) : null}
          </div>
        )}
        {fail ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border-2 border-caution bg-caution-tint p-3">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
            <span>{fail.message}</span>
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="grid gap-6">
      {header}

      {disabled ? (
        <p role="status" className="flex items-start gap-3 rounded-md bg-sunken p-4">
          <Lock aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>
            <strong>Demo mode is not set up on this server.</strong> You can still follow steps 1 to 3 and open the
            comparison page, but the demo actors cannot be run here.
          </span>
        </p>
      ) : null}

      <section aria-labelledby={`${uid}-progress`} className="slip">
        <div className="px-4 py-3">
          <h2 id={`${uid}-progress`} className="font-sans text-lg font-bold">
            Where the demo is
          </h2>
          <p className="mt-1">
            <span className="font-mono">{doneCount}</span> of <span className="font-mono">4</span> demo-actor steps
            done.
          </p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {ORDER.map((id, i) => (
              <li key={id} className="flex items-center gap-2">
                {done(id) ? (
                  <CircleCheck aria-hidden size={18} className="shrink-0 text-success" />
                ) : (
                  <Clock aria-hidden size={18} className="shrink-0 text-ink-muted" />
                )}
                <span>
                  Step <span className="font-mono">{i + 4}</span>: {done(id) ? "done" : "not run"}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-2 px-4 py-3">
          <p className="slip-label">
            Comparison status for <span className="font-mono">{UNIT_CODE}</span> right now (from the real comparison)
          </p>
          <div>
            <Stamp label={statusMeta.stamp} icon={statusMeta.icon} tone={statusMeta.tone} />
          </div>
        </div>
        <div className="px-4 py-3">
          <label htmlFor={`${uid}-pass`} className="font-bold">
            Demo passcode
          </label>
          <p id={`${uid}-pass-hint`} className="text-sm text-ink-muted">
            Needed for steps 4 to 7 and reset. Kept in this browser tab only, until you close it.
          </p>
          <input
            ref={passRef}
            id={`${uid}-pass`}
            type="password"
            autoComplete="off"
            value={passcode}
            disabled={disabled}
            onChange={(e) => {
              setPasscode(e.target.value);
              try {
                sessionStorage.setItem(PASS_KEY, e.target.value);
              } catch {
                /* storage blocked: the passcode stays in memory only */
              }
            }}
            aria-invalid={failure?.passcode ? true : undefined}
            aria-describedby={`${uid}-pass-hint${failure?.passcode ? ` ${uid}-pass-err` : ""}`}
            className={`field mt-2 md:max-w-sm ${failure?.passcode ? "border-2 border-caution" : ""}`}
          />
          {failure?.passcode ? (
            <p id={`${uid}-pass-err`} className="mt-1 text-caution">
              {failure.message}
            </p>
          ) : null}
        </div>
      </section>

      <ol className="grid gap-8">
        <Beat n={1} title="A voter captures the result sheet offline">
          <p>
            Open Capture on a phone, choose <span className="font-mono">{UNIT_CODE}</span>, and use the synthetic
            sample sheet. Turn on airplane mode before you press &ldquo;Save this photo&rdquo;.
          </p>
          <BeatLinks>
            <Link href="/capture" className="btn btn-primary no-underline">
              Open Capture
            </Link>
            <a href="/demo/synthetic-result-sheet.jpg" download className="btn btn-secondary no-underline">
              <Download aria-hidden size={20} />
              Download the synthetic sample sheet
            </a>
          </BeatLinks>
        </Beat>

        <Beat n={2} title="The original is kept and synced">
          <p>
            The receipt shows the photo&rsquo;s fingerprint while still offline. Turn airplane mode off: the
            submission changes to &ldquo;Received by server&rdquo; once the server&rsquo;s own fingerprint matches.
          </p>
          <BeatLinks>
            <Link href="/submissions" className="btn btn-secondary no-underline">
              Open your submissions
            </Link>
          </BeatLinks>
        </Beat>

        <Beat n={3} title="The figures are confirmed by a person">
          <p>
            From the receipt, open the ProofTrail and choose &ldquo;Read the figures&rdquo;. &ldquo;Load demo
            figures&rdquo; fills in figures labelled &ldquo;Demo figures — not read from this photo&rdquo;. Check
            them against the photo and confirm.
          </p>
          <BeatLinks>
            <Link href="/submissions" className="btn btn-secondary no-underline">
              Open your ProofTrail (via submissions)
            </Link>
          </BeatLinks>
        </Beat>

        <Beat n={4} title={STAGES.WITNESSES.title}>
          {stageCard("WITNESSES")}
        </Beat>

        <Beat n={5} title={STAGES.DUPLICATE.title}>
          {stageCard("DUPLICATE")}
        </Beat>

        <Beat n={6} title={STAGES.REVIEWS.title}>
          {stageCard("REVIEWS")}
          <p className="mt-3 text-sm">
            To show the review screens, sign in as Synthetic Demo Reviewer A after step 3 (this replaces the
            contributor session in this browser).
          </p>
          <BeatLinks>
            <Link href="/reviewer?next=/review" className="btn btn-secondary no-underline">
              Sign in as Reviewer A
            </Link>
          </BeatLinks>
        </Beat>

        <Beat n={7} title={STAGES.REFERENCE.title}>
          {stageCard("REFERENCE")}
        </Beat>

        <Beat n={8} title="The ProofTrail explains the difference">
          <p>
            The public comparison shows the difference (&ldquo;Reference is 60 higher&rdquo;) and why no allegation
            is made. A witness ProofTrail shows each step that photo went through.
          </p>
          <BeatLinks>
            <Link href={`/units/${DEMO_UNIT_ID}`} className="btn btn-primary no-underline">
              Open the comparison for {UNIT_CODE}
            </Link>
            {demo.evidence.witness1 ? (
              <Link href={`/evidence/${demo.evidence.witness1}`} className="btn btn-secondary no-underline">
                Witness 1 ProofTrail
              </Link>
            ) : null}
          </BeatLinks>
          {demo.evidence.witness1 ? (
            <p className="mt-1 text-sm">The witness ProofTrail opens for a reviewer session.</p>
          ) : null}
        </Beat>
      </ol>

      <section aria-labelledby={`${uid}-reset`} className="border-t border-rule pt-6">
        <h2 id={`${uid}-reset`} className="text-xl">
          Reset demo scenario
        </h2>
        <p className="mt-2">
          Use this before each run so steps 4 to 7 start again from the beginning.
        </p>
        {resetDone ? (
          <p role="status" className="mt-3 flex items-start gap-3 rounded-md bg-success-tint p-3">
            <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
            <span>
              Demo scenario reset. Comparison status for <span className="font-mono">{UNIT_CODE}</span> is now:{" "}
              <strong>{STATUS_META[resetDone as DemoState["verificationStatus"]].stamp}</strong>.
            </span>
          </p>
        ) : null}
        {!confirmReset ? (
          <button
            type="button"
            className="btn btn-secondary mt-3 w-full md:w-auto"
            disabled={disabled || busy !== null || !online}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw aria-hidden size={20} />
            Reset demo scenario
          </button>
        ) : (
          <div className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-4">
            <h3 className="text-lg font-bold">Reset the demo scenario?</h3>
            <p className="mt-2">
              This removes only the records created by the synthetic demo actors (Witnesses 1 to 3 and Reviewers A
              and B) on <span className="font-mono">{UNIT_CODE}</span>. Evidence from anyone else, including a photo
              you captured live, is never changed or removed.
            </p>
            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void call("RESET")}>
                {busy === "RESET" ? "Resetting…" : "Reset now"}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setConfirmReset(false)}>
                Keep everything
              </button>
            </div>
          </div>
        )}
        {failure?.stage === "RESET" && !failure.passcode ? (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border-2 border-caution bg-caution-tint p-3">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
            <span>{failure.message}</span>
          </p>
        ) : null}
        {disabled ? <p className="mt-1 text-sm">Demo mode is not set up on this server.</p> : null}
      </section>

      <p>
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 font-bold text-primary">
          <ArrowLeft aria-hidden size={20} />
          Back to PollTrace
        </Link>
      </p>
    </div>
  );
}

function Beat({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  // Number sits inline with the heading so the step body uses the full width at 360px.
  return (
    <li>
      <h2 className="flex items-start gap-3 font-sans text-lg font-bold">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary font-mono font-semibold text-primary"
        >
          {n}
        </span>
        <span className="pt-1">
          <span className="sr-only">Step {n}: </span>
          {title}
        </span>
      </h2>
      <div className="mt-2 grid gap-2">{children}</div>
    </li>
  );
}

function BeatLinks({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{children}</div>;
}

/** What the server returned for a finished stage: status + the ids it created, as links. */
function StageResult({
  id,
  demo,
  statusAfterRun,
  summary,
}: {
  id: DemoStageId;
  demo: DemoState;
  statusAfterRun: DemoState["verificationStatus"] | null;
  summary: string;
}) {
  const links: Array<{ href: string; label: string }> = [];
  if (id === "WITNESSES") {
    if (demo.evidence.witness1) links.push({ href: `/evidence/${demo.evidence.witness1}`, label: "Witness 1 evidence" });
    if (demo.evidence.witness2) links.push({ href: `/evidence/${demo.evidence.witness2}`, label: "Witness 2 evidence" });
  }
  if (id === "DUPLICATE" && demo.evidence.duplicate)
    links.push({ href: `/evidence/${demo.evidence.duplicate}`, label: "Witness 3 evidence (exact copy)" });
  if (id === "REFERENCE" && demo.referenceId)
    links.push({ href: `/units/${demo.unitId}/references#ref-${demo.referenceId}`, label: "Reference record" });
  if (id === "REVIEWS" || id === "REFERENCE") links.push({ href: `/units/${demo.unitId}`, label: "Comparison page" });

  const status = statusAfterRun ? STATUS_META[statusAfterRun] : null;
  return (
    <div className="grid gap-2 rounded-md bg-sunken p-3">
      {summary ? <p>{summary}</p> : null}
      {status ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Comparison status after this step: <Stamp small label={status.stamp} icon={status.icon} tone={status.tone} />
        </p>
      ) : null}
      {links.length ? (
        <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="inline-flex min-h-11 items-center font-bold text-primary">
                {l.label}
                {l.href.startsWith("/evidence/") ? <span className="sr-only"> (opens for a reviewer session)</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {links.some((l) => l.href.startsWith("/evidence/")) ? (
        <p className="text-sm">Evidence links open for a reviewer session.</p>
      ) : null}
      <p className="flex items-center gap-2 text-sm">
        <DemoTag /> Created by synthetic demo actors.
      </p>
    </div>
  );
}
