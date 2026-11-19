"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { FlaskConical, TriangleAlert, WifiOff } from "lucide-react";
import { ActionBar } from "@/components/action-bar";
import { DemoTag } from "@/components/demo-band";
import { plural } from "@/components/client/format";
import { refreshSession, signOut, useSession } from "@/components/client/session";
import { getDB } from "@/lib/offline/db";
import { useOnline } from "@/lib/offline/use-network";

type Failure = "wrongPasscode" | "notSetUp" | "disabled" | "network" | "other" | null;

const REVIEWERS = [
  { value: "A", name: "Synthetic Demo Reviewer A" },
  { value: "B", name: "Synthetic Demo Reviewer B" },
] as const;

/** Same-origin path only; anything else falls back to the review list. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/review";
  return raw;
}

export function ReviewerSignIn({ passcodeRequired }: { passcodeRequired: boolean }) {
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const online = useOnline();
  const uid = useId();
  const [reviewer, setReviewer] = useState<"A" | "B" | null>(null);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [chooseError, setChooseError] = useState(false);

  // Photos still waiting on this device would be stranded by replacing the contributor session.
  const waiting = useLiveQuery(
    () => getDB().captures.where("status").anyOf("SAVED_LOCAL", "UPLOADING", "NEEDS_ATTENTION").count(),
    [],
    undefined,
  );

  const back = (
    <Link href="/" className="btn btn-secondary w-full no-underline">
      Back to PollTrace
    </Link>
  );

  if (session.status === "loading") return <p className="text-ink-muted">Loading…</p>;

  const s = session.status === "ready" ? session.session : null;

  if (s?.role === "REVIEWER") {
    return (
      <section>
        <h1 className="text-xl md:text-2xl">Reviewer sign-in</h1>
        <p className="mt-4">
          You are signed in as <strong>{s.alias}</strong> <DemoTag />
        </p>
        <div className="mt-4 grid gap-2">
          <Link href="/review" className="btn btn-primary w-full no-underline">
            Go to review list
          </Link>
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={async () => {
              if (await signOut()) router.push("/");
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const disabledOnServer = s?.demoReviewersEnabled === false || failure === "disabled";
  if (disabledOnServer) {
    return (
      <section>
        <h1 className="text-xl md:text-2xl">Reviewer sign-in</h1>
        <p className="mt-4">Demo reviewer sign-in is turned off on this server.</p>
        <div className="mt-4">{back}</div>
      </section>
    );
  }

  const guard = (waiting ?? 0) > 0;
  const blockedReason = !online
    ? "You are offline. Signing in needs a connection."
    : guard
      ? "Upload waiting photos first."
      : waiting === undefined
        ? "Checking this device…"
        : null;

  async function submit() {
    if (!reviewer) {
      setChooseError(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    let res: Response;
    try {
      res = await fetch("/api/session/demo-reviewer", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(passcodeRequired ? { reviewer, passcode } : { reviewer }),
      });
    } catch {
      setBusy(false);
      setFailure("network");
      return;
    }
    if (res.ok) {
      await refreshSession();
      router.push(safeNext(params.get("next")));
      return;
    }
    setBusy(false);
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const msg = body?.error?.message ?? "";
    if (res.status === 403 && body?.error?.code === "DEMO_REVIEWERS_DISABLED") {
      // The server uses one code for three cases; tell them apart without echoing server text.
      if (/passcode must be set/i.test(msg)) setFailure("notSetUp");
      else if (/invalid .*passcode/i.test(msg)) setFailure("wrongPasscode");
      else setFailure("disabled");
    } else setFailure("other");
  }

  const actions = (
    <>
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={busy || blockedReason !== null}
        onClick={() => void submit()}
      >
        {busy ? "Signing in…" : "Sign in as demo reviewer"}
      </button>
      {back}
    </>
  );
  const note = blockedReason ? <p className="text-sm">{blockedReason}</p> : undefined;

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h1 id={`${uid}-h`} className="text-xl md:text-2xl">
        Reviewer sign-in
      </h1>

      <div className="mt-4 rounded-md border-2 border-dashed border-demo bg-demo-tint p-4 text-demo">
        <p className="flex items-start gap-2">
          <FlaskConical aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>
            <strong>These are synthetic demo reviewer accounts.</strong> They are not real people and do not represent
            any accreditation, election body or organisation. Decisions made with them are labelled as demo decisions.
          </span>
        </p>
      </div>

      {!online ? (
        <p className="mt-4 flex items-start gap-3 rounded-md bg-sunken p-4">
          <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>You are offline. Signing in needs a connection.</span>
        </p>
      ) : null}

      {guard ? (
        <div className="mt-4 rounded-md border-2 border-caution bg-caution-tint p-4">
          <p className="flex items-start gap-2 font-bold">
            <TriangleAlert aria-hidden size={20} className="mt-0.5 shrink-0 text-caution" />
            <span>
              This device has <span className="font-mono">{waiting}</span> {plural(waiting ?? 0, "photo")} waiting to
              upload.
            </span>
          </p>
          <p className="mt-2">
            Signing in as a reviewer replaces your contributor session. Upload them first, or use a different browser
            for reviewing.
          </p>
          <Link href="/submissions" className="btn btn-secondary mt-3 w-full no-underline">
            Go to submissions
          </Link>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !blockedReason) void submit();
        }}
        className="mt-6"
      >
        <fieldset aria-describedby={`${uid}-hint${chooseError ? ` ${uid}-err` : ""}`}>
          <legend className="text-lg font-bold">Sign in as</legend>
          <p id={`${uid}-hint`} className="text-sm text-ink-muted">
            Two demo reviewers exist so you can show that a second person reviews independently.
          </p>
          {chooseError && !reviewer ? (
            <p id={`${uid}-err`} className="mt-1 text-caution">
              Choose a demo reviewer.
            </p>
          ) : null}
          <div className="mt-2 grid gap-2">
            {REVIEWERS.map((r) => (
              <label
                key={r.value}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border-2 p-3 ${
                  reviewer === r.value ? "border-primary bg-primary-tint" : "border-rule bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name={`${uid}-reviewer`}
                  checked={reviewer === r.value}
                  onChange={() => setReviewer(r.value)}
                  className="size-5 shrink-0 accent-primary"
                />
                <span className="font-bold">{r.name}</span>
                <DemoTag />
              </label>
            ))}
          </div>
        </fieldset>

        {passcodeRequired ? (
          <div className="mt-6">
            <label htmlFor={`${uid}-pass`} className="text-lg font-bold">
              Demo passcode
            </label>
            <p id={`${uid}-pass-hint`} className="text-sm text-ink-muted">
              Given to you by the demo organiser.
            </p>
            <input
              id={`${uid}-pass`}
              type="password"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              aria-invalid={failure === "wrongPasscode" ? true : undefined}
              aria-describedby={`${uid}-pass-hint${failure === "wrongPasscode" ? ` ${uid}-pass-err` : ""}`}
              className={`field mt-2 ${failure === "wrongPasscode" ? "border-2 border-caution" : ""}`}
            />
            {failure === "wrongPasscode" ? (
              <p id={`${uid}-pass-err`} role="alert" className="mt-1 text-caution">
                That passcode is not right. Check it and try again.
              </p>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite" className="mt-4">
          {failure === "network" ? (
            <p role="alert">Could not reach the server. Try again.</p>
          ) : failure === "notSetUp" ? (
            <p role="alert">Reviewer sign-in is not set up on this server yet.</p>
          ) : failure === "other" || (failure === "wrongPasscode" && !passcodeRequired) ? (
            <p role="alert">Sign-in did not work. Try again.</p>
          ) : null}
        </div>
      </form>

      <div className="md:hidden">
        <ActionBar note={note}>{actions}</ActionBar>
      </div>
      <div className="mt-4 hidden gap-2 md:grid">
        {note}
        {actions}
      </div>
    </section>
  );
}
