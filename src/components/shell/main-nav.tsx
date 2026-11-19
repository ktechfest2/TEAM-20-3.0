"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "@/lib/offline/db";

const TABS = [
  { href: "/capture", label: "Capture" },
  { href: "/submissions", label: "Submissions" },
  { href: "/units", label: "Find unit" },
] as const;

export function MainNav() {
  const pathname = usePathname();
  const waiting = useLiveQuery(
    () => getDB().captures.where("status").anyOf("SAVED_LOCAL", "UPLOADING", "NEEDS_ATTENTION").count(),
    [],
    0,
  );
  return (
    <nav aria-label="Main" className="border-b border-rule bg-surface text-ink">
      <ul className="mx-auto grid max-w-6xl grid-cols-3 md:flex md:gap-2 md:px-4">
        {TABS.map((t) => {
          const current = pathname === t.href || pathname.startsWith(`${t.href}/`);
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
                {t.href === "/submissions" && waiting > 0 ? (
                  <span
                    className="inline-flex min-w-6 items-center justify-center rounded-full bg-ink px-1.5 font-mono text-xs font-semibold text-surface"
                    aria-label={`${waiting} waiting`}
                  >
                    {waiting}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
