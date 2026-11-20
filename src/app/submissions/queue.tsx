"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { WifiOff } from "lucide-react";
import { CaptureStamp, CAPTURE_STAMP } from "@/components/stamp";
import { captureBlob, getDB, type CaptureStatus, type LocalCapture } from "@/lib/offline/db";
import { receiptNumber, shortFingerprint } from "@/lib/offline/hash";
import { ATTENTION_COPY, syncAll, uploadCapture, type AttentionReason } from "@/lib/offline/sync";
import { useOnline } from "@/lib/offline/use-network";
import { findPollingUnit } from "@/lib/seed/registry";

const ORDER: CaptureStatus[] = ["NEEDS_ATTENTION", "UPLOADING", "SAVED_LOCAL", "RECEIVED"];
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Queue() {
  const online = useOnline();
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const captures = useLiveQuery(async () => {
    try {
      return await getDB().captures.orderBy("capturedAt").reverse().toArray();
    } catch {
      setReadError(true);
      return [];
    }
  }, []);

  if (readError) {
    return (
      <div role="alert" className="mt-4 rounded-md border-2 border-conflict bg-conflict-tint p-4 text-conflict">
        <p>We could not open the photos saved on this device. Reload the page. Your photos have not been deleted.</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  if (captures === undefined) {
    return (
      <p aria-busy="true" className="mt-4 text-ink-muted">
        Loading your saved photos…
      </p>
    );
  }
  if (captures.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="text-xl">No submissions yet</h2>
        <p className="mt-2">When you photograph a result sheet, it is saved here first, then uploaded.</p>
        <Link href="/capture" className="btn btn-primary mt-4 w-full no-underline">
          Capture a result
        </Link>
      </section>
    );
  }

  const groups = ORDER.map((s) => ({ status: s, items: captures.filter((c) => c.status === s) }));
  const pending = captures.filter((c) => c.status === "SAVED_LOCAL" || c.status === "NEEDS_ATTENTION").length;

  return (
    <>
      {!online ? (
        <p className="mt-4 flex items-start gap-3 rounded-md bg-sunken p-4">
          <WifiOff aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>
            <strong>You are offline.</strong> Your photos are safe on this device. They will upload when you
            reconnect.
          </span>
        </p>
      ) : pending > 0 ? (
        <div className="mt-4 rounded-md bg-sunken p-4">
          <p className="font-bold">
            {pending} {pending === 1 ? "photo" : "photos"} waiting to upload.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-3 w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await syncAll(true);
              setBusy(false);
            }}
          >
            {busy ? "Uploading…" : "Upload all now"}
          </button>
        </div>
      ) : null}

      <p className="mt-4 text-sm text-ink-muted">
        {groups
          .filter((g) => g.items.length)
          .map((g) => `${g.items.length} ${CAPTURE_STAMP[g.status].label.toLowerCase()}`)
          .join(" · ")}
      </p>

      {groups.map((g) =>
        g.items.length ? (
          <section key={g.status} aria-labelledby={`g-${g.status}`} className="mt-6">
            <h2 id={`g-${g.status}`} className="font-sans text-lg font-bold">
              {CAPTURE_STAMP[g.status].label} <span className="font-mono text-ink-muted">({g.items.length})</span>
            </h2>
            <ul className="mt-2 grid gap-3">
              {g.items.map((c) => (
                <Row key={c.id} capture={c} online={online} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}

function Thumb({ capture }: { capture: LocalCapture }) {
  // Decorative thumbnail of the local original; the row text carries the meaning.
  const ref = useRef<HTMLSpanElement>(null);
  const { bytes, blob, mime } = capture;
  useEffect(() => {
    let u: string | null = null;
    try {
      u = URL.createObjectURL(captureBlob({ bytes, blob, mime }));
      if (ref.current) ref.current.style.backgroundImage = `url("${u}")`;
    } catch {
      /* unreadable original: keep the plain placeholder square */
    }
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [bytes, blob, mime]);
  return (
    <span
      ref={ref}
      aria-hidden
      className="size-14 shrink-0 rounded-sm border border-rule bg-sunken bg-cover bg-center"
    />
  );
}

function Row({ capture: c, online }: { capture: LocalCapture; online: boolean }) {
  const unit = findPollingUnit(c.pollingUnitId);
  const reason = c.lastError as AttentionReason | null;
  const attention = c.status === "NEEDS_ATTENTION";
  const integrity = attention && reason === "HASH_MISMATCH";

  let detail: string;
  if (c.status === "SAVED_LOCAL") detail = online ? "Will upload shortly." : "Waiting for network.";
  else if (c.status === "UPLOADING") detail = "Uploading…";
  else if (c.status === "RECEIVED")
    // Integrity claim + its scope note live on the ProofTrail page; review status is server-side.
    detail = `Received ${c.serverReceipt ? fmt(c.serverReceipt.receivedAt) : ""} · File arrived unchanged`;
  else detail = reason ? ATTENTION_COPY[reason] : "Something went wrong. Your photo is still saved on this device.";

  return (
    <li
      className={`rounded-md border-2 bg-surface p-3 ${
        integrity ? "border-conflict" : attention ? "border-caution" : "border-rule"
      }`}
    >
      <div className="flex gap-3">
        <Thumb capture={c} />
        <div className="min-w-0 flex-1">
          <p className="font-mono font-semibold">{unit?.code ?? c.pollingUnitId}</p>
          <p>
            {unit?.name}
          </p>
          <p className="text-sm text-ink-muted">Saved {fmt(c.capturedAt)} (phone clock)</p>
          <p className="text-sm text-ink-muted">
            Fingerprint <span className="font-mono whitespace-nowrap text-ink">{shortFingerprint(c.sha256)}</span>
          </p>
        </div>
      </div>
      <div className="mt-3">
        <CaptureStamp status={c.status} integrityFailure={integrity} />
      </div>
      <p className="mt-2">{detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {attention || (c.status === "SAVED_LOCAL" && online) ? (
          <button
            type="button"
            className={`btn ${attention ? "btn-primary" : "btn-secondary"}`}
            onClick={() => void uploadCapture(c.id)}
            disabled={!online}
          >
            {attention ? "Try again" : "Upload now"}
          </button>
        ) : null}
        <Link href={`/capture?step=receipt&id=${c.id}`} className="btn btn-secondary no-underline">
          Receipt <span className="font-mono">{receiptNumber(c.id)}</span>
        </Link>
      </div>
    </li>
  );
}
