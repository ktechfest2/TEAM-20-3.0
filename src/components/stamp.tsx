import { CircleCheck, RefreshCw, Smartphone, TriangleAlert, type LucideIcon } from "lucide-react";
import type { CaptureStatus } from "@/lib/offline/db";

export type Tone = "local" | "progress" | "done" | "attention" | "integrity" | "outline" | "demo";

const TONE: Record<Tone, string> = {
  local: "bg-sunken text-ink",
  progress: "bg-primary-tint text-primary",
  done: "bg-success-tint text-success",
  attention: "bg-caution-tint text-caution",
  integrity: "bg-conflict-tint text-conflict",
  outline: "bg-surface text-ink",
  // Synthetic data only: the one dashed border in the product.
  demo: "border-dashed bg-demo-tint text-demo",
};

export const CAPTURE_STAMP: Record<CaptureStatus, { label: string; icon: LucideIcon; tone: Tone }> = {
  SAVED_LOCAL: { label: "Saved on this device", icon: Smartphone, tone: "local" },
  UPLOADING: { label: "Uploading", icon: RefreshCw, tone: "progress" },
  RECEIVED: { label: "Received by server", icon: CircleCheck, tone: "done" },
  NEEDS_ATTENTION: { label: "Needs attention", icon: TriangleAlert, tone: "attention" },
};

export function Stamp({
  label,
  icon: Icon,
  tone,
  spinning = false,
  small = false,
}: {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  spinning?: boolean;
  small?: boolean;
}) {
  return (
    <span className={`stamp ${TONE[tone]} ${small ? "px-1.5 py-0" : ""}`}>
      <Icon aria-hidden size={small ? 16 : 18} strokeWidth={2.25} className={spinning ? "motion-safe:animate-spin" : undefined} />
      {label}
    </span>
  );
}

export function CaptureStamp({ status, integrityFailure = false }: { status: CaptureStatus; integrityFailure?: boolean }) {
  const s = CAPTURE_STAMP[status];
  return (
    <Stamp
      label={s.label}
      icon={s.icon}
      tone={status === "NEEDS_ATTENTION" && integrityFailure ? "integrity" : s.tone}
      spinning={status === "UPLOADING"}
    />
  );
}
