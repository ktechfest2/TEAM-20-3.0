"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserCheck } from "lucide-react";
import { isReviewer, signOut, useSession } from "@/components/client/session";
import { displayAlias } from "@/components/client/format";

/** Identity strip shown on every page while a (sample) reviewer is signed in. */
export function ReviewerStrip() {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!isReviewer(session) || session.status !== "ready") return null;
  const { alias } = session.session;

  return (
    <div className="border-b border-rule bg-sunken text-ink">
      <div className="mx-auto flex min-h-11 max-w-6xl items-center justify-between gap-1.5 px-4 text-sm">
        {/* One row at 360: the icon and "Signed in as" are visual extras on wider screens only. */}
        <p className="flex min-w-0 items-center gap-1.5">
          <UserCheck aria-hidden size={20} strokeWidth={2} className="hidden shrink-0 sm:block" />
          <span className="min-w-0">
            <span className="sr-only sm:not-sr-only">Signed in as </span>
            <strong className="whitespace-nowrap">{displayAlias(alias)}</strong>
          </span>
         
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {failed ? (
            <span role="alert" className="text-sm">
              Could not sign out.
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-md px-1 font-bold whitespace-nowrap text-primary underline underline-offset-4 disabled:opacity-60"
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              const ok = await signOut();
              setBusy(false);
              if (ok) router.push("/");
              else setFailed(true);
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
