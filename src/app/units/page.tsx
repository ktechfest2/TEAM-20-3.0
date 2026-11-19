import type { Metadata } from "next";
import { DemoTag } from "@/components/demo-band";
import { POLLING_UNITS } from "@/lib/seed/registry";

export const metadata: Metadata = { title: "Find a polling unit" };

export default function UnitsPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-12">
      <h1 className="text-xl md:text-2xl">Polling units</h1>
      <p className="mt-2">
        Comparison pages for each unit are coming next. For now this lists the demo registry used for capture.
      </p>
      <ul className="slip mt-4">
        {POLLING_UNITS.map((u) => (
          <li key={u.id} className="px-4 py-3">
            <p className="font-mono font-semibold">{u.code}</p>
            <p>
              {u.name} {u.synthetic ? <DemoTag /> : null}
            </p>
            <p className="text-sm text-ink-muted">
              {u.ward} · {u.lga} · {u.state}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
