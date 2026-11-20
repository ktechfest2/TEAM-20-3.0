"use client";

import { useState } from "react";
import { Eye, EyeOff, Maximize2, ZoomIn, ZoomOut, ExternalLink } from "lucide-react";
import { OriginalPhoto } from "@/components/evidence/original-photo";

/**
 * Photo kept in view while typing. The caller makes the wrapper sticky. Height uses dvh so it
 * shrinks with the on-screen keyboard and the focused input stays visible; full height on wide screens.
 * Page pinch-zoom is never disabled; these buttons are an extra, not a replacement.
 */
export function PhotoPanel({ src, synthetic, code }: { src: string; synthetic: boolean; code: string }) {
  const [zoom, setZoom] = useState(1);
  const [hidden, setHidden] = useState(false);
  const max = () => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? 4 : 3);

  return (
    <div className="pt-2 pb-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={!hidden}
          className="inline-flex min-h-11 items-center gap-2 font-bold text-primary"
          onClick={() => setHidden((h) => !h)}
        >
          {hidden ? <Eye aria-hidden size={20} /> : <EyeOff aria-hidden size={20} />}
          {hidden ? "Show photo" : "Hide photo"}
        </button>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 font-bold text-primary"
        >
          Open full size <ExternalLink aria-hidden size={18} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {hidden ? null : (
        <div>
          <div
            className="h-[clamp(120px,28dvh,240px)] overflow-auto rounded-lg border border-rule bg-sunken lg:h-[calc(100dvh-10rem)]"
            style={{ touchAction: "pan-x pan-y pinch-zoom" }}
            tabIndex={0}
            role="region"
            aria-label={`Original photo for ${code}, zoom ${zoom * 100}%`}
          >
            <OriginalPhoto
              src={src}
              synthetic={synthetic}
              alt={`Original photo of the result sheet for ${code}`}
              imgClassName="block max-w-none"
              imgStyle={{ width: `${zoom * 100}%` }}
            />
          </div>
          {/* Controls sit under the image, never over it, so they cannot hide figures on the sheet. */}
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="font-mono text-sm text-ink-muted" aria-live="polite">
              Zoom {zoom * 100}%
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((z) => Math.max(1, z - 1))}
                className="inline-flex size-11 items-center justify-center rounded-md border border-rule bg-surface text-ink disabled:opacity-40"
              >
                <ZoomOut aria-hidden size={20} />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= max()}
                onClick={() => setZoom((z) => Math.min(max(), z + 1))}
                className="inline-flex size-11 items-center justify-center rounded-md border border-rule bg-surface text-ink disabled:opacity-40"
              >
                <ZoomIn aria-hidden size={20} />
              </button>
              <button
                type="button"
                aria-label="Fit"
                onClick={() => setZoom(1)}
                className="inline-flex size-11 items-center justify-center rounded-md border border-rule bg-surface text-ink"
              >
                <Maximize2 aria-hidden size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
