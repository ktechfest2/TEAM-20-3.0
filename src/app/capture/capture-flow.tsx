"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { UnitStep } from "./unit-step";
import { PhotoStep } from "./photo-step";
import { ReceiptStep } from "./receipt-step";
import { findPollingUnit } from "@/lib/seed/registry";

/** URL holds the step so refresh and the back button behave: ?step=unit|photo|receipt */
export function CaptureFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const step = params.get("step") ?? "unit";
  const unit = findPollingUnit(params.get("unit") ?? "");
  const captureId = params.get("id");

  const go = (q: Record<string, string>) => router.push(`/capture?${new URLSearchParams(q).toString()}`);

  if (step === "receipt" && captureId) return <ReceiptStep captureId={captureId} />;
  if (step === "photo" && unit) {
    return (
      <PhotoStep
        unit={unit}
        onChangeUnit={() => go({ step: "unit", unit: unit.id })}
        onSaved={(id) => router.replace(`/capture?step=receipt&id=${id}`)}
      />
    );
  }
  return <UnitStep initialUnitId={unit?.id ?? null} onConfirm={(id) => go({ step: "photo", unit: id })} />;
}
