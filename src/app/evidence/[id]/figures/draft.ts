/**
 * Local draft of the figures a person is typing. Lives in this browser only (localStorage) so a
 * refresh or going offline never loses typing. It is never a server record: nothing is confirmed
 * until POST /confirm returns a revision.
 */
import type { ConfirmRequest, ResultRevisionView, RevisionOrigin } from "@/lib/contracts/trace";
import type { FormType } from "@/lib/contracts";
import { FIGURE_KEYS, figureValue, figureLabel, type FigureKey } from "@/components/evidence/figures";
import { PARTY_ROSTER } from "@/lib/seed/registry";

export type FieldDraft = {
  value: string;
  unreadable: boolean;
  /** Pre-filled from the synthetic demo fixture and not changed since. */
  fromDemo: boolean;
  /** The source revision marked this one as uncertain. */
  flagged: boolean;
};

export type Draft = {
  basedOnRevision: number;
  baseOrigin: RevisionOrigin;
  formType: FormType;
  code: string;
  fields: Record<FigureKey, FieldDraft>;
  note: string;
  /** Notice string from ExtractResponse, shown verbatim. Null when the draft started from a stored revision. */
  notice: string | null;
  savedAt: string;
};

const KEY = (id: string) => `polltrace:figures-draft:${id}`;

export function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (typeof d?.basedOnRevision !== "number" || !d.fields) return null;
    for (const k of FIGURE_KEYS) if (!d.fields[k]) return null;
    return d;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store (private mode, storage full). */
export function saveDraft(id: string, d: Draft): boolean {
  try {
    localStorage.setItem(KEY(id), JSON.stringify({ ...d, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(id: string) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}

export function draftFromRevision(r: ResultRevisionView, notice: string | null): Draft {
  // A MANUAL draft is an empty form: blank, not "unreadable". Elsewhere null means unreadable.
  const blankMeansEmpty = r.origin === "MANUAL";
  const fields = {} as Record<FigureKey, FieldDraft>;
  for (const k of FIGURE_KEYS) {
    const v = figureValue(r, k);
    const entry = r.entries.find((e) => e.partyCode === k);
    fields[k] = {
      value: v === null ? "" : String(v),
      unreadable: v === null && !blankMeansEmpty,
      fromDemo: r.origin === "DEMO_FIXTURE" && v !== null,
      flagged: Boolean(entry?.needsReview && v !== null && !r.humanConfirmed),
    };
  }
  return {
    basedOnRevision: r.revisionNumber,
    baseOrigin: r.origin,
    formType: r.formType,
    code: r.pollingUnitCodeOnSheet ?? "",
    fields,
    note: "",
    notice,
    savedAt: new Date().toISOString(),
  };
}

export const DIGITS = /^[0-9]+$/;

export function fieldNumber(f: FieldDraft): number | null {
  if (f.unreadable) return null;
  const v = f.value.trim();
  return DIGITS.test(v) ? Number(v) : null;
}

export type Problem = { key: FigureKey; message: string };

/** Fields that block moving to Check: blank-and-not-unreadable, or not digits. */
export function blockingProblems(d: Draft): Problem[] {
  const out: Problem[] = [];
  for (const k of FIGURE_KEYS) {
    const f = d.fields[k];
    if (f.unreadable) continue;
    const v = f.value.trim();
    if (v === "") out.push({ key: k, message: `${figureLabel(k)} is empty. Type the number, or tick “I can't read this”.` });
    else if (!DIGITS.test(v)) out.push({ key: k, message: `${figureLabel(k)}: use numbers only (0–9).` });
  }
  return out;
}

/** Non-blocking consistency checks, computed live. The server's warnings stay authoritative. */
export function consistencyChecks(d: Draft, unitCode: string): string[] {
  const out: string[] = [];
  const n = (k: FigureKey) => fieldNumber(d.fields[k]);
  const parties = PARTY_ROSTER.map((k) => n(k));
  const valid = n("validVotes");
  const rejected = n("rejectedVotes");
  const accredited = n("accreditedVoters");
  if (valid !== null && parties.every((p) => p !== null)) {
    const sum = (parties as number[]).reduce((a, b) => a + b, 0);
    if (sum !== valid)
      out.push(
        `Party votes add up to ${sum}. Total valid votes is ${valid}. Please check both numbers on the photo. A difference can come from a misread number.`,
      );
  }
  if (valid !== null && rejected !== null && accredited !== null && valid + rejected > accredited) {
    out.push(
      `Valid votes plus rejected votes (${valid + rejected}) is more than accredited voters (${accredited}). Please check these numbers on the photo.`,
    );
  }
  const code = d.code.trim();
  if (code && code.toUpperCase() !== unitCode.toUpperCase()) {
    out.push(
      `The code on the sheet (${code}) is not the same as the polling unit you chose (${unitCode}). Check that this is the right sheet. You can still continue.`,
    );
  }
  return out;
}

export function toConfirmRequest(d: Draft): ConfirmRequest {
  const note = d.note.trim();
  return {
    basedOnRevision: d.basedOnRevision,
    formType: d.formType,
    pollingUnitCodeOnSheet: d.code.trim() || null,
    entries: PARTY_ROSTER.map((k) => ({
      partyCode: k,
      votes: fieldNumber(d.fields[k]),
      needsReview: d.fields[k].unreadable,
    })),
    accreditedVoters: fieldNumber(d.fields.accreditedVoters),
    rejectedVotes: fieldNumber(d.fields.rejectedVotes),
    validVotes: fieldNumber(d.fields.validVotes),
    ...(note ? { note } : {}),
  };
}
