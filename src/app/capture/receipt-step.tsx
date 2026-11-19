"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ActionBar } from "@/components/action-bar";
import { CaptureStamp } from "@/components/stamp";
import { DemoTag } from "@/components/demo-band";
import { getDB } from "@/lib/offline/db";
import { groupedHash, receiptNumber, shortFingerprint } from "@/lib/offline/hash";
import { ATTENTION_COPY, uploadCapture, type AttentionReason } from "@/lib/offline/sync";
import { useOnline } from "@/lib/offline/use-network";
import { findPollingUnit } from "@/lib/seed/registry";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const HEADINGS = {
  SAVED_LOCAL: "Saved on this device",
  UPLOADING: "Uploading",
  RECEIVED: "Received by server",
  NEEDS_ATTENTION: "Needs attention",
} as const;

export function ReceiptStep({ captureId }: { captureId: string }) {
  const online = useOnline();
  const [copied, setCopied] = useState(false);
  // undefined = still loading; null = not on this device
  const capture = useLiveQuery(async () => (await getDB().captures.get(captureId)) ?? null, [captureId]);

  if (capture === undefined) {
    return (
      <p aria-busy="true" className="text-ink-muted">
        Opening your receipt…
      </p>
    );
  }
  if (capture === null) {
    return (
      <section>
        <h1 className="text-xl">Receipt not found on this device</h1>
        <p className="mt-2">
          This receipt is not saved in this browser. It may have been saved in a different browser or phone.
        </p>
        <Link href="/submissions" className="btn btn-secondary mt-4 w-full no-underline">
          See all submissions
        </Link>
      </section>
    );
  }

  const unit = findPollingUnit(capture.pollingUnitId);
  const receipt = capture.serverReceipt;
  const integrityConfirmed = capture.status === "RECEIVED" && receipt?.sha256 === capture.sha256;
  const reason = capture.lastError as AttentionReason | null;
  const sha = capture.sha256;

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(sha);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the full hash is visible to copy by hand */
    }
  }

  return (
    <section aria-labelledby="receipt-h1">
      <div aria-live="polite">
        <CaptureStamp status={capture.status} integrityFailure={reason === "HASH_MISMATCH"} />
      </div>
      <h1 id="receipt-h1" className="mt-3 text-xl md:text-2xl">
        {HEADINGS[capture.status]}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 3 of 3 · Your receipt</p>

      {capture.status === "SAVED_LOCAL" || capture.status === "UPLOADING" ? (
        <p className="mt-3">
          <strong>Not yet received by server.</strong> It will upload when you have a network. You can close
          PollTrace. The photo stays saved.
        </p>
      ) : null}
      {capture.status === "NEEDS_ATTENTION" && reason ? <p className="mt-3">{ATTENTION_COPY[reason]}</p> : null}

      <dl className="slip mt-4">
        <Segment label="Polling unit">
          <span className="font-mono">{unit?.code ?? capture.pollingUnitId}</span>
          <span className="block">
            {unit?.name} {capture.synthetic ? <DemoTag /> : null}
          </span>
        </Segment>
        <Segment label="Taken as">
          {capture.sourceType === "OBSERVER_PHOTO" ? "Accredited observer or party agent" : "Voter or witness"}{" "}
          <span className="text-sm text-ink-muted">(your own statement, not checked)</span>
        </Segment>
        <Segment label="Photo fingerprint (SHA-256)">
          <span className="font-mono text-lg">{shortFingerprint(sha)}</span>
          {integrityConfirmed ? (
            <span className="mt-1 block text-success">
              <strong>Source integrity confirmed.</strong> The server’s fingerprint matches yours.
            </span>
          ) : null}
        </Segment>
        <Segment label="Receipt number">
          <span className="font-mono text-lg">{receiptNumber(capture.id)}</span>
        </Segment>
        <Segment label="Saved">
          <span className="font-mono">{fmt(capture.capturedAt)}</span> (phone clock)
        </Segment>
        {receipt ? (
          <Segment label="Server received">
            <span className="font-mono">{fmt(receipt.receivedAt)}</span>
          </Segment>
        ) : null}
      </dl>

      <details className="mt-4 rounded-md border border-rule bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold text-primary">
          Show full fingerprint and receipt
        </summary>
        <div className="px-4 pb-4">
          <p className="slip-label">Fingerprint</p>
          <p className="font-mono break-words">{groupedHash(sha)}</p>
          <button type="button" onClick={copyHash} className="btn btn-secondary mt-2">
            {copied ? "Copied" : "Copy fingerprint"}
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? "Fingerprint copied" : ""}
          </span>
          <p className="slip-label mt-4">Full receipt number</p>
          <p className="font-mono break-all">{capture.id}</p>
        </div>
      </details>

      <details className="mt-3 rounded-md border border-rule bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold text-primary">
          What is a fingerprint?
        </summary>
        <p className="px-4 pb-4">
          It is a code made from the photo’s exact bytes. If even one byte changes, the code changes. The server
          makes its own fingerprint and compares. A match shows the file arrived unchanged. It does not show that
          what the photo shows is true.
        </p>
      </details>

      <ActionBar
        note={
          !online && capture.status !== "RECEIVED" ? (
            <p className="text-sm">Waiting for network. We will try again automatically.</p>
          ) : undefined
        }
      >
        {capture.status === "RECEIVED" && receipt ? (
          <Link href={`/evidence/${receipt.id}`} className="btn btn-primary w-full no-underline">
            View ProofTrail
          </Link>
        ) : online && capture.status !== "UPLOADING" ? (
          <button type="button" className="btn btn-primary w-full" onClick={() => void uploadCapture(capture.id)}>
            {capture.status === "NEEDS_ATTENTION" ? "Try again" : "Upload now"}
          </button>
        ) : (
          <Link href="/capture" className="btn btn-primary w-full no-underline">
            Capture another result
          </Link>
        )}
        <Link href="/submissions" className="btn btn-secondary w-full no-underline">
          See all submissions
        </Link>
      </ActionBar>
    </section>
  );
}

function Segment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="slip-label">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
