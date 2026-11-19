"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { Ban, CircleCheck } from "lucide-react";
import { ReviewEventView, type EvidenceTrace } from "@/lib/contracts/trace";
import { EvidenceStatus, type Independence, type ReviewDecision } from "@/lib/contracts";
import { apiJson, issueMessages } from "@/components/client/api";
import { fmtTime } from "@/components/client/format";
import { latestRevisionOf } from "@/components/evidence/use-trace";
import { Choice } from "@/components/choice";

const ReviewResponse = z.object({ review: ReviewEventView, status: EvidenceStatus });

const DECISIONS: Array<{ value: ReviewDecision; title: string; text: string }> = [
  {
    value: "ACCEPTED",
    title: "Accept: usable in comparison",
    text: "The sheet is readable and the confirmed figures match what you see on the photo.",
  },
  {
    value: "FLAGGED",
    title: "Flag for another look",
    text: "Something needs checking before a decision. It stays waiting for review.",
  },
  {
    value: "REJECTED",
    title: "Do not accept",
    text: "Not usable in comparison. For example: the sheet cannot be read, it is a different polling unit, or it is not a result sheet.",
  },
];
const DECISION_SHORT: Record<ReviewDecision, string> = { ACCEPTED: "Accept", FLAGGED: "Flag for another look", REJECTED: "Do not accept" };

const INDEPENDENCE: Array<{ value: Independence; title: string; text: string }> = [
  { value: "UNVERIFIED", title: "Not assessed", text: "You have no information either way. This is the safe choice." },
  {
    value: "REVIEWER_CONFIRMED",
    title: "Independent source",
    text: "You have a specific reason to believe a separate person took this photo.",
  },
  {
    value: "DISPUTED",
    title: "Not independent, or doubtful",
    text: "You have a reason to believe it shares a source with another submission.",
  },
];

type Outcome =
  | { kind: "none" }
  | { kind: "recorded"; at: string }
  | { kind: "selfReview" }
  | { kind: "sessionEnded" }
  | { kind: "invalid"; message: string }
  | { kind: "network" };

const MAX_REASON = 2000;

export function ReviewPanel({ trace, offline, onRecorded }: { trace: EvidenceTrace; offline: boolean; onRecorded: () => void }) {
  const { permissions, integrity, evidence } = trace;
  const latest = latestRevisionOf(trace);
  const canAccept = Boolean(latest?.humanConfirmed);
  const isCopy = integrity.exactDuplicateCount > 0;
  const uid = useId();

  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [independence, setIndependence] = useState<Independence>("UNVERIFIED");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ decision?: string; reason?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const summaryRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);

  const ids = { decision: `${uid}-decision`, independence: `${uid}-indep`, reason: `${uid}-reason` };

  if (!permissions.canReview || outcome.kind === "selfReview") {
    return (
      <section id="review" aria-labelledby={`${uid}-h`} className="slip scroll-mt-4 px-4 py-4">
        <h2 id={`${uid}-h`} className="text-xl">
          Your review
        </h2>
        <div className="mt-3 flex items-start gap-3 rounded-md bg-sunken p-4">
          <Ban aria-hidden size={20} className="mt-0.5 shrink-0" />
          <div>
            {outcome.kind === "selfReview" ? (
              <p>You cannot review a photo you sent. Another reviewer must review it. Nothing was recorded.</p>
            ) : (
              <>
                <p>You cannot review this photo. {permissions.reviewBlockedReason}</p>
                <p className="mt-1">Another reviewer must review it.</p>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!decision) next.decision = "Choose a decision.";
    if (reason.trim().length < 3) next.reason = "Write a short reason. A few words are enough.";
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return false;
    }
    return true;
  }

  async function record() {
    if (!decision) return;
    setSubmitting(true);
    const r = await apiJson(`/api/evidence/${evidence.id}/review`, ReviewResponse, {
      method: "POST",
      body: { decision, independenceStatus: independence, reason: reason.trim() },
    });
    setSubmitting(false);
    if (r.ok) {
      setOutcome({ kind: "recorded", at: r.data.review.createdAt });
      setConfirming(false);
      onRecorded();
      return;
    }
    if (r.kind === "network") return setOutcome({ kind: "network" });
    if (r.kind === "http" && r.code === "SELF_REVIEW") return setOutcome({ kind: "selfReview" });
    if (r.kind === "http" && (r.status === 401 || r.status === 403)) return setOutcome({ kind: "sessionEnded" });
    if (r.kind === "http" && r.code === "NO_CONFIRMED_REVISION")
      return setOutcome({ kind: "invalid", message: "no figures have been checked and confirmed by a person" });
    const msgs = r.kind === "http" ? issueMessages(r.body) : [];
    setOutcome({
      kind: "invalid",
      message: msgs.join("; ") || (r.kind === "http" && r.message) || "the server did not accept it",
    });
  }

  if (outcome.kind === "recorded") {
    return (
      <section id="review" aria-labelledby={`${uid}-h`} className="slip scroll-mt-4 px-4 py-4">
        <h2 id={`${uid}-h`} className="text-xl">
          Your review
        </h2>
        <div role="status" className="mt-3 flex items-start gap-3 rounded-md bg-success-tint p-4 text-ink">
          <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-success" />
          <p>
            Decision recorded at <span className="font-mono">{fmtTime(outcome.at)}</span>. It is now part of this
            record&rsquo;s ProofTrail.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 md:flex-row">
          <Link href="/review" className="btn btn-primary no-underline">
            Back to review list (next item)
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setOutcome({ kind: "none" });
              setDecision(null);
              setIndependence("UNVERIFIED");
              setReason("");
            }}
          >
            Record another decision
          </button>
        </div>
      </section>
    );
  }

  const errorList = Object.entries(errors).filter(([, v]) => v) as Array<[keyof typeof ids, string]>;

  return (
    <section id="review" aria-labelledby={`${uid}-h`} className="slip scroll-mt-4 px-4 py-4">
      <h2 id={`${uid}-h`} className="text-xl">
        Your review
      </h2>

      {errorList.length ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-3 text-ink"
        >
          <p className="font-bold">Before you continue:</p>
          <ul className="mt-1 list-disc pl-5">
            {errorList.map(([k, msg]) => (
              <li key={k}>
                <a href={`#${ids[k]}`} className="text-ink">
                  {msg}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset id={ids.decision} className="mt-4" disabled={confirming} aria-describedby={errors.decision ? `${ids.decision}-err` : undefined}>
        <legend className="text-lg font-bold">Decision</legend>
        {errors.decision ? (
          <p id={`${ids.decision}-err`} className="mt-1 text-caution">
            {errors.decision}
          </p>
        ) : null}
        <div className="mt-2 grid gap-2">
          {DECISIONS.map((d) => {
            const disabled = d.value === "ACCEPTED" && !canAccept;
            return (
              <Choice
                key={d.value}
                name={`${uid}-decision`}
                checked={decision === d.value}
                disabled={disabled}
                onChange={() => setDecision(d.value)}
                title={d.title}
                text={disabled ? "Not available yet: no figures have been checked and confirmed by a person." : d.text}
              />
            );
          })}
        </div>
      </fieldset>

      <fieldset id={ids.independence} className="mt-6" disabled={confirming}>
        <legend className="text-lg font-bold">Is this an independent source?</legend>
        <div className="mt-2 rounded-md bg-sunken p-3">
          <p className="font-bold">Matching photos are not independent witnesses.</p>
          <p className="mt-1 text-sm">
            Two photos can come from the same person, the same group chat, or one shared picture. Only mark a source
            independent if you have a specific reason to believe it is separate from the other submissions.
          </p>
          <p className="mt-1 text-sm">
            The sender&rsquo;s role on this photo is their own statement and has not been checked.
          </p>
        </div>
        <div className="mt-2 grid gap-2">
          {INDEPENDENCE.map((o) => {
            const disabled = o.value === "REVIEWER_CONFIRMED" && isCopy;
            return (
              <Choice
                key={o.value}
                name={`${uid}-indep`}
                checked={independence === o.value}
                disabled={disabled}
                onChange={() => setIndependence(o.value)}
                title={o.title}
                text={
                  disabled
                    ? "Not available: this file is an exact copy of another submission. Exact copies cannot be independent."
                    : o.text
                }
              />
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6">
        <label htmlFor={ids.reason} className="text-lg font-bold">
          Reason
        </label>
        <p id={`${ids.reason}-hint`} className="text-sm text-ink-muted">
          Say what you saw. Your reason is kept with your decision and shown in this record&rsquo;s ProofTrail.
        </p>
        <textarea
          id={ids.reason}
          rows={4}
          maxLength={MAX_REASON}
          value={reason}
          readOnly={confirming}
          onChange={(ev) => setReason(ev.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={`${ids.reason}-hint ${ids.reason}-count${errors.reason ? ` ${ids.reason}-err` : ""}`}
          className={`field mt-2 ${errors.reason ? "border-2 border-caution" : ""}`}
        />
        <p id={`${ids.reason}-count`} className="text-right font-mono text-xs text-ink-muted">
          {reason.length} / {MAX_REASON}
        </p>
        {errors.reason ? (
          <p id={`${ids.reason}-err`} role="alert" className="text-caution">
            {errors.reason}
          </p>
        ) : null}
      </div>

      {!confirming ? (
        <button
          type="button"
          className="btn btn-primary mt-4 w-full md:w-auto"
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
      ) : (
        <div className="mt-4 rounded-md border-2 border-caution bg-caution-tint p-4">
          <h3 ref={confirmRef} tabIndex={-1} className="text-lg font-bold">
            Record this decision?
          </h3>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="inline font-bold">Decision: </dt>
              <dd className="inline">{decision ? DECISION_SHORT[decision] : ""}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Independence: </dt>
              <dd className="inline">{INDEPENDENCE.find((o) => o.value === independence)?.title}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Reason: </dt>
              <dd className="inline">“{reason.trim()}”</dd>
            </div>
          </dl>
          <p className="mt-3 font-bold">
            This decision is kept permanently. A later decision can supersede it but not erase it.
          </p>

          {outcome.kind === "network" ? (
            <p role="alert" className="mt-3">
              Could not reach the server. Nothing was recorded. Your choices are kept. Try again.
            </p>
          ) : outcome.kind === "invalid" ? (
            <p role="alert" className="mt-3">
              This decision could not be recorded: {outcome.message}. Nothing was saved.
            </p>
          ) : outcome.kind === "sessionEnded" ? (
            <p role="alert" className="mt-3">
              Your reviewer session has ended. Nothing was recorded.{" "}
              <Link href={`/reviewer?next=${encodeURIComponent(`/evidence/${evidence.id}#review`)}`} className="font-bold text-primary">
                Sign in again to continue.
              </Link>
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <button type="button" className="btn btn-primary" disabled={submitting || offline} onClick={() => void record()}>
              {submitting ? "Recording…" : "Record decision"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => {
                setConfirming(false);
                setOutcome({ kind: "none" });
              }}
            >
              Go back and change
            </button>
          </div>
          {offline ? <p className="mt-2 text-sm">Needs a connection</p> : null}
        </div>
      )}
    </section>
  );
}

