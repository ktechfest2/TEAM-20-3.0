"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useOnline } from "@/lib/offline/use-network";

export function SiteHeader({ nav }: { nav: ReactNode }) {
  const online = useOnline();
  return (
    <header className="bg-primary text-on-primary">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-display text-lg font-semibold no-underline focus-visible:outline-white">
          PollTrace
        </Link>
        <p
          role="status"
          aria-live="polite"
          className="inline-flex h-8 items-center gap-2 rounded-full border border-white/90 px-3 text-xs font-bold"
        >
          {online ? <Wifi aria-hidden size={18} strokeWidth={2} /> : <WifiOff aria-hidden size={18} strokeWidth={2} />}
          {online ? "Online" : "Offline"}
        </p>
      </div>
      {nav}
    </header>
  );
}
