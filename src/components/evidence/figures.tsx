import { Info, TriangleAlert } from "lucide-react";
import type { ResultRevisionView } from "@/lib/contracts/trace";
import { PARTY_ROSTER } from "@/lib/seed/registry";
import { partyLabel } from "@/components/client/format";

export type FigureKey = (typeof PARTY_ROSTER)[number] | "accreditedVoters" | "rejectedVotes" | "validVotes";

export const TOTAL_LABELS = {
  accreditedVoters: "Accredited voters",
  rejectedVotes: "Rejected votes",
  validVotes: "Total valid votes",
} as const;

export const FIGURE_KEYS: FigureKey[] = [...PARTY_ROSTER, "accreditedVoters", "rejectedVotes", "validVotes"];

export const figureLabel = (k: FigureKey) => (k in TOTAL_LABELS ? TOTAL_LABELS[k as keyof typeof TOTAL_LABELS] : partyLabel(k));

export const FORM_TYPE_LABEL = { EC8A: "EC8A", EC60E: "EC60E", UNKNOWN: "Not sure" } as const;

export function figureValue(r: ResultRevisionView, k: FigureKey): number | null {
  if (k === "accreditedVoters" || k === "rejectedVotes" || k === "validVotes") return r[k];
  return r.entries.find((e) => e.partyCode === k)?.votes ?? null;
}

export function Unreadable() {
  return (
    <span className="inline-flex items-center gap-1 font-sans text-caution">
      <TriangleAlert aria-hidden size={18} />
      Unreadable
    </span>
  );
}

const Num = ({ v }: { v: number | null }) => (v === null ? <Unreadable /> : <>{v}</>);

/** Full table of one revision. Null is "Unreadable", never 0 or blank. */
export function FiguresTable({ revision, caption }: { revision: ResultRevisionView; caption?: string }) {
  const rows: Array<[string, React.ReactNode]> = [
    ...FIGURE_KEYS.map((k) => [figureLabel(k), <Num key={k} v={figureValue(revision, k)} />] as [string, React.ReactNode]),
    ["Form type", FORM_TYPE_LABEL[revision.formType]],
    [
      "Polling unit code on sheet",
      revision.pollingUnitCodeOnSheet ?? <span className="font-sans text-ink-muted">Not given</span>,
    ],
  ];
  return (
    <table className="w-full border-collapse text-left">
      <caption className="pb-2 text-left text-sm text-ink-muted">
        {caption ?? `Version ${revision.revisionNumber} of the figures`}
      </caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-t border-rule">
            <th scope="row" className="py-2 pr-3 font-normal">
              {label}
            </th>
            <td className="py-2 text-right font-mono">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Warnings({ warnings, heading }: { warnings: string[]; heading?: string }) {
  if (!warnings.length) return null;
  return (
    <div className="rounded-md bg-sunken p-3">
      {heading ? <p className="mb-1 text-sm font-bold">{heading}</p> : null}
      <ul className="grid gap-2">
        {warnings.map((w) => (
          <li key={w} className="flex items-start gap-2">
            <Info aria-hidden size={20} className="mt-0.5 shrink-0" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type FieldChange = { label: string; before: string; after: string };

const show = (v: number | string | null) => (v === null ? "unreadable" : String(v));

export function diffRevisions(prev: ResultRevisionView, next: ResultRevisionView): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of FIGURE_KEYS) {
    const a = figureValue(prev, k);
    const b = figureValue(next, k);
    if (a !== b) out.push({ label: figureLabel(k), before: show(a), after: show(b) });
  }
  if (prev.formType !== next.formType)
    out.push({ label: "Form type", before: FORM_TYPE_LABEL[prev.formType], after: FORM_TYPE_LABEL[next.formType] });
  if (prev.pollingUnitCodeOnSheet !== next.pollingUnitCodeOnSheet)
    out.push({
      label: "Code on sheet",
      before: prev.pollingUnitCodeOnSheet ?? "not given",
      after: next.pollingUnitCodeOnSheet ?? "not given",
    });
  return out;
}

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="grid gap-1">
      {changes.map((c) => (
        <li key={c.label}>
          {c.label}:{" "}
          {c.before === "unreadable" ? (
            // Nothing was read before, so there is nothing to strike through.
            <>
              not read <span aria-hidden>→</span>
              <span className="sr-only">, now</span> <span className="font-mono">{c.after}</span>
            </>
          ) : (
            <span className="font-mono">
              <span className="sr-only">was </span>
              <s className="text-ink-muted">{c.before}</s> <span aria-hidden>→</span>
              <span className="sr-only">, now</span> {c.after}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
