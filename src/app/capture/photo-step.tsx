"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImageIcon, Sun, UserX, Maximize } from "lucide-react";
import { ActionBar } from "@/components/action-bar";
import { DemoTag } from "@/components/demo-band";
import { ELECTIONS } from "@/lib/seed/registry";
import { StorageFullError, saveCapture } from "@/lib/offline/db";
import { MAX_ORIGINAL_BYTES, type PollingUnit } from "@/lib/contracts";

type SaveError = "STORAGE_FULL" | "STORAGE_UNAVAILABLE" | "NO_CRYPTO" | "HASH_FAILED" | null;

const fmtMB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const fmtTime = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function PhotoStep({
  unit,
  onChangeUnit,
  onSaved,
}: {
  unit: PollingUnit;
  onChangeUnit: () => void;
  onSaved: (captureId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notImage, setNotImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError>(null);
  const [lowStorage, setLowStorage] = useState(false);
  const cameraId = useId();
  const galleryId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Revoke the preview URL when it is replaced or the step unmounts.
  useEffect(() => {
    if (!preview) return;
    headingRef.current?.focus();
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again after Retake
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setNotImage(true);
      return;
    }
    setNotImage(false);
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    navigator.storage
      ?.estimate?.()
      .then(({ quota, usage }) => {
        if (quota !== undefined && usage !== undefined) setLowStorage(quota - usage < 50 * 1024 * 1024);
      })
      .catch(() => undefined);
  }

  async function save() {
    if (!file) return;
    if (!globalThis.crypto?.subtle) {
      setError("NO_CRYPTO");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const election = ELECTIONS[0];
      const rec = await saveCapture({
        blob: file,
        fileName: file.name,
        electionId: election.id,
        pollingUnitId: unit.id,
        synthetic: unit.synthetic || election.synthetic,
      });
      onSaved(rec.id);
    } catch (e) {
      if (e instanceof StorageFullError) setError("STORAGE_FULL");
      else if ((e as { name?: string })?.name === "OperationError") setError("HASH_FAILED");
      else setError("STORAGE_UNAVAILABLE");
      setSaving(false);
    }
  }

  const unitLine = (
    <p className="mt-2 flex flex-wrap items-center gap-x-2">
      <span className="font-mono font-semibold">{unit.code}</span>
      <span aria-hidden>·</span>
      <span>
        {unit.name} {unit.synthetic ? <DemoTag /> : null}
      </span>
      <button type="button" onClick={onChangeUnit} className="min-h-11 px-1 text-primary underline">
        Change
      </button>
    </p>
  );

  const pickers = (
    <>
      <input id={cameraId} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
      <input id={galleryId} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} />
      <label htmlFor={cameraId} className="btn btn-primary w-full">
        <Camera aria-hidden size={20} /> Take photo
      </label>
      <label htmlFor={galleryId} className="btn btn-secondary w-full">
        <ImageIcon aria-hidden size={20} /> Choose from gallery
      </label>
    </>
  );

  if (!file || !preview) {
    return (
      <section aria-labelledby="photo-h1">
        <h1 id="photo-h1" className="text-xl md:text-2xl">
          Photograph the result sheet
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Step 2 of 3</p>
        {unitLine}
        <ul className="mt-6 grid gap-3">
          <Tip icon={<Maximize aria-hidden size={20} />}>Fit the whole sheet in the photo.</Tip>
          <Tip icon={<Sun aria-hidden size={20} />}>Hold steady. Avoid shadow and glare.</Tip>
          <Tip icon={<UserX aria-hidden size={20} />}>Do not photograph people’s faces.</Tip>
        </ul>
        {notImage ? (
          <p role="alert" className="mt-6 rounded-md border-2 border-caution bg-caution-tint p-4 text-caution">
            This file is not a photo. Choose a JPG or PNG photo.
          </p>
        ) : null}
        <p className="mt-6 text-sm text-ink-muted">
          If the camera does not open, use “Choose from gallery” with a photo you already took.
        </p>
        <ActionBar>{pickers}</ActionBar>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-h1">
      <h1 id="review-h1" ref={headingRef} tabIndex={-1} className="text-xl outline-none md:text-2xl">
        Check your photo
      </h1>
      <p className="mt-1 text-sm text-ink-muted">Step 2 of 3</p>
      {unitLine}
      <figure className="relative mt-4 overflow-hidden rounded-lg border border-rule bg-sunken">
        {unit.synthetic ? (
          <span className="absolute top-2 left-2">
            <DemoTag />
          </span>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL of the original */}
        <img src={preview} alt="The photo you chose of the result sheet" className="max-h-[60vh] w-full object-contain" />
      </figure>
      <p className="mt-2">
        <a href={preview} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-primary underline">
          Open full size
        </a>
      </p>
      <p className="mt-2">This is the original photo. PollTrace keeps it exactly as it is. No cropping, no editing.</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        <dt className="text-ink-muted">Size</dt>
        <dd className="font-mono">{fmtMB(file.size)}</dd>
        <dt className="text-ink-muted">Taken</dt>
        <dd>
          <span className="font-mono">{fmtTime(new Date(file.lastModified))}</span> (phone clock)
        </dd>
      </dl>
      {file.size > MAX_ORIGINAL_BYTES ? (
        <p className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-3 text-sm text-caution">
          This photo is large ({fmtMB(file.size)}). The server accepts photos up to 15 MB, so it may not upload. It
          will still be saved on this device.
        </p>
      ) : null}
      {lowStorage ? (
        <p className="mt-3 rounded-md border-2 border-caution bg-caution-tint p-3 text-sm text-caution">
          Your phone is almost full. Saving may fail.
        </p>
      ) : null}
      {error ? <SaveErrorPanel error={error} /> : null}

      <ActionBar>
        <p className="sr-only" aria-live="polite">
          {saving ? "Saving the photo and making its fingerprint" : ""}
        </p>
        <button type="button" className="btn btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? "Saving… making fingerprint" : error ? "Try again" : "Save this photo"}
        </button>
        <button
          type="button"
          className="btn btn-secondary w-full"
          disabled={saving}
          onClick={() => {
            setFile(null);
            setPreview(null);
            setError(null);
          }}
        >
          Retake
        </button>
      </ActionBar>
    </section>
  );
}

function Tip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

const ERROR_COPY: Record<Exclude<SaveError, null>, { title: string; body: string }> = {
  STORAGE_FULL: {
    title: "Your phone is out of space, so the photo was not saved.",
    body: "Free up space (delete old videos or apps), then tap Try again. Your photo is still selected.",
  },
  STORAGE_UNAVAILABLE: {
    title: "This browser cannot save photos on this device.",
    body: "It may be in private mode. Open PollTrace in a normal browser window, then try again.",
  },
  NO_CRYPTO: {
    title: "This page cannot make a photo fingerprint.",
    body: "Open PollTrace with its secure link (starting with https) to save photos.",
  },
  HASH_FAILED: {
    title: "We could not make the photo’s fingerprint, so it was not saved.",
    body: "Try again. If it keeps failing, choose the photo again from your gallery.",
  },
};

function SaveErrorPanel({ error }: { error: Exclude<SaveError, null> }) {
  const c = ERROR_COPY[error];
  return (
    <div role="alert" className="mt-4 rounded-md border-2 border-conflict bg-conflict-tint p-4 text-conflict">
      <p className="font-bold">{c.title}</p>
      <p className="mt-1">{c.body}</p>
    </div>
  );
}
