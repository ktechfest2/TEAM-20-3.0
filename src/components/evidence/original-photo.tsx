"use client";

import { useState, type CSSProperties } from "react";
import { ImageOff } from "lucide-react";

/**
 * The private original, served for this viewer only. Rendered as-is (no crop, no filter).
 */
export function OriginalPhoto({
  src,
  alt,
  className = "",
  imgClassName = "w-full",
  imgStyle,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  imgStyle?: CSSProperties;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <div className={`flex flex-col items-start gap-3 rounded-lg bg-sunken p-4 ${className}`}>
        <p className="flex items-start gap-2">
          <ImageOff aria-hidden size={20} className="mt-1 shrink-0" />
          <span>The photo could not be shown right now. Its fingerprint record is unaffected.</span>
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setFailed(false);
            setLoaded(false);
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`} aria-busy={!loaded || undefined}>
      {loaded ? null : (
        <p className="flex aspect-[4/3] w-full items-center justify-center bg-sunken p-4 text-sm text-ink-muted">
          Loading photo…
        </p>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- private, no-store original; must not be optimised or re-encoded */}
      <img
        key={attempt}
        ref={(el) => {
          // Already decoded from cache before React attached onLoad.
          if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
        }}
        src={attempt ? `${src}?retry=${attempt}` : src}
        alt={alt}
        className={loaded ? imgClassName : "sr-only"}
        style={loaded ? imgStyle : undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
