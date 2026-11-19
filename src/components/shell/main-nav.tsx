"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "@/lib/offline/db";
import { ReviewQueueResponse } from "@/lib/contracts/trace";
import { apiJson } from "@/components/client/api";
import { isReviewer, useSession } from "@/components/client/session";

type Tab = { href: string; label: string; badge?: "local" | "review" };

const CAPTURER_TABS: Tab[] = [
  { href: "/capture", label: "Capture" },
  { href: "/submissions", label: "Submissions", badge: "local" },
  { href: "/units", label: "Find unit" },
];
// A reviewer session must not capture on this device (the contributor identity was replaced).
const REVIEWER_TABS: Tab[] = [
  { href: "/review", label: "Review", badge: "review" },
  { href: "/units", label: "Find unit" },
  { href: "/submissions", label: "Submissions", badge: "local" },
];

function useReviewCount(enabled: boolean, pathname: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    apiJson("/api/review/queue", ReviewQueueResponse, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) setCount(r.data.items.length);
      })
      .catch(() => {
        /* aborted */
      });
    return () => ctrl.abort();
  }, [enabled, pathname]);
  return enabled ? count : null;
}

/**
 * usePathname is request data on dynamic routes (cacheComponents), so the live nav sits in its
 * own Suspense boundary; the fallback is the same tab row with no current tab marked.
 */
export function MainNav() {
  return (
    <Suspense fallback={<NavTabs pathname="" />}>
      <LiveNav />
    </Suspense>
  );
}

function LiveNav() {
  return <NavTabs pathname={usePathname()} />;
}

function NavTabs({ pathname }: { pathname: string }) {
  const session = useSession();
  const reviewer = isReviewer(session);
  const reviewCount = useReviewCount(reviewer, pathname);
  const waiting = useLiveQuery(
    () => getDB().captures.where("status").anyOf("SAVED_LOCAL", "UPLOADING", "NEEDS_ATTENTION").count(),
    [],
    0,
  );
  const tabs = reviewer ? REVIEWER_TABS : CAPTURER_TABS;
  return (
    <nav aria-label="Main" className="border-b border-rule bg-surface text-ink">
      <ul className="mx-auto grid max-w-6xl grid-cols-3 md:flex md:gap-2 md:px-4">
        {tabs.map((t) => {
          const current = pathname === t.href || pathname.startsWith(`${t.href}/`);
          const n = t.badge === "local" ? waiting : t.badge === "review" ? reviewCount : null;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-12 items-center justify-center gap-2 border-b-[3px] px-2 text-sm no-underline md:px-4 ${
                  current ? "border-primary font-bold text-primary" : "border-transparent text-ink"
                }`}
              >
                {t.label}
                {n !== null && n > 0 ? (
                  <>
                    <span
                      aria-hidden
                      className="inline-flex min-w-6 items-center justify-center rounded-full bg-ink px-1.5 font-mono text-xs font-semibold text-surface"
                    >
                      {n}
                    </span>
                    <span className="sr-only">, {n} waiting</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
