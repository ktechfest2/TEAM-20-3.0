"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserCheck } from "lucide-react";
import { DemoTag } from "@/components/demo-band";
import { isReviewer, signOut, useSession } from "@/components/client/session";

/** Identity strip shown on every page while a (synthetic demo) reviewer is signed in. */
export function ReviewerStrip() {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!isReviewer(session) || session.status !== "ready") return null;
  const { alias, synthetic } = session.session;

  return (
    <div className="border-b border-rule bg-sunken text-ink">
      <div className="mx-auto flex min-h-11 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <UserCheck aria-hidden size={20} strokeWidth={2} className="shrink-0" />
          <span>
            Signed in as <strong>{alias ?? "a reviewer"}</strong>
          </span>
          {synthetic ? <DemoTag /> : null}
        </p>
        <div className="flex items-center gap-3">
          {failed ? (
            <span role="alert" className="text-sm">
              Could not sign out. Try again.
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-md px-3 font-bold text-primary underline underline-offset-4 disabled:opacity-60"
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
