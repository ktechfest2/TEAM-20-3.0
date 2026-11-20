/**
 * Local draft of the figures a person is typing. Lives in this browser only (localStorage) so a
 * refresh or going offline never loses typing. It is never a server record: nothing is confirmed
 * until POST /confirm returns a revision.
 *
 * AI drafts (REAL_VISION): each AI value is a suggestion. The draft remembers the AI's value
 * (`aiValue`) so the UI can say "Changed by you (AI suggested …)", and which fields the AI was not
 * sure about (`uncertain`), each of which needs an "I checked this on the photo" tick (`checked`)
 * before the check step. Editing a value clears its tick.
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
  /** The source revision (demo/manual) marked this one as needing a look. */
  flagged: boolean;
  /** The AI's suggested value for this field (string form), or null when not an AI draft / AI read nothing. */
  aiValue: string | null;
  /** The AI was not sure about this field. */
  uncertain: boolean;
  /** The person ticked "I checked this on the photo". */
  checked: boolean;
};

/** Sheet-detail fields can also be uncertain in an AI draft. */
export type MetaDraft = { aiValue: string | null; uncertain: boolean; checked: boolean };

export type Draft = {
  basedOnRevision: number;
  baseOrigin: RevisionOrigin;
  formType: FormType;
  code: string;
  fields: Record<FigureKey, FieldDraft>;
  formTypeMeta: MetaDraft;
  codeMeta: MetaDraft;
  note: string;
  /** Notice string from ExtractResponse, shown verbatim. Null when the draft started from a stored revision. */
  notice: string | null;
  savedAt: string;
};

const KEY = (id: string) => `polltrace:figures-draft:${id}`;
const NO_META: MetaDraft = { aiValue: null, uncertain: false, checked: false };

/** Older drafts (saved before AI fields existed) get safe defaults. */
function normalise(d: Draft): Draft {
  const fields = {} as Record<FigureKey, FieldDraft>;
  for (const k of FIGURE_KEYS) {
    const f = d.fields[k] as Partial<FieldDraft> & Pick<FieldDraft, "value" | "unreadable" | "fromDemo" | "flagged">;
    fields[k] = { ...f, aiValue: f.aiValue ?? null, uncertain: f.uncertain ?? false, checked: f.checked ?? false };
  }
  return { ...d, fields, formTypeMeta: d.formTypeMeta ?? NO_META, codeMeta: d.codeMeta ?? NO_META };
}

export function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (typeof d?.basedOnRevision !== "number" || !d.fields) return null;
    for (const k of FIGURE_KEYS) if (!d.fields[k]) return null;
    return normalise(d);
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

export const isAiDraft = (d: Draft) => d.baseOrigin === "REAL_VISION";

export function draftFromRevision(r: ResultRevisionView, notice: string | null): Draft {
  const ai = r.origin === "REAL_VISION" && !r.humanConfirmed;
  // MANUAL and AI drafts leave unread fields blank (to type), not "unreadable". Elsewhere null = unreadable.
  const blankMeansEmpty = r.origin === "MANUAL" || ai;
  const uncertainSet = new Set(ai ? r.uncertainFields : []);
  const fields = {} as Record<FigureKey, FieldDraft>;
  for (const k of FIGURE_KEYS) {
    const v = figureValue(r, k);
    const entry = r.entries.find((e) => e.partyCode === k);
    fields[k] = {
      value: v === null ? "" : String(v),
      unreadable: v === null && !blankMeansEmpty,
      fromDemo: r.origin === "DEMO_FIXTURE" && v !== null,
      flagged: !ai && Boolean(entry?.needsReview && v !== null && !r.humanConfirmed),
      aiValue: ai && v !== null ? String(v) : null,
      uncertain: ai && (uncertainSet.has(k) || Boolean(entry?.needsReview && v !== null)),
      checked: false,
    };
  }
  return {
    basedOnRevision: r.revisionNumber,
    baseOrigin: r.origin,
    formType: r.formType,
    code: r.pollingUnitCodeOnSheet ?? "",
    fields,
    formTypeMeta: ai ? { aiValue: r.formType, uncertain: uncertainSet.has("formType"), checked: false } : NO_META,
    codeMeta: ai
      ? { aiValue: r.pollingUnitCodeOnSheet, uncertain: uncertainSet.has("pollingUnitCode"), checked: false }
      : NO_META,
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

/** An AI value the person changed (compared as typed, ignoring surrounding spaces). */
export const changedFromAi = (f: FieldDraft) => f.aiValue !== null && (f.unreadable || f.value.trim() !== f.aiValue);

/** Uncertain AI field that still needs the "I checked this on the photo" tick. */
export const needsTick = (f: FieldDraft) =>
  f.uncertain && f.aiValue !== null && !f.checked && !f.unreadable && !changedFromAi(f);

export type ProblemKey = FigureKey | "formType" | "pollingUnitCode";
export type Problem = { key: ProblemKey; message: string };

const tickMessage = (label: string) => `Check ${label} against the photo, then tick “I checked this on the photo”.`;

/** Fields that block moving to Check. */
export function blockingProblems(d: Draft): Problem[] {
  const out: Problem[] = [];
  if (d.formTypeMeta.uncertain && !d.formTypeMeta.checked && d.formType === d.formTypeMeta.aiValue)
    out.push({ key: "formType", message: tickMessage("Form type") });
  if (d.codeMeta.uncertain && !d.codeMeta.checked && d.code.trim() !== "" && d.code.trim() === (d.codeMeta.aiValue ?? ""))
    out.push({ key: "pollingUnitCode", message: tickMessage("Polling unit code on the sheet") });
  for (const k of FIGURE_KEYS) {
    const f = d.fields[k];
    if (f.unreadable) continue;
    const v = f.value.trim();
    if (v === "") out.push({ key: k, message: `${figureLabel(k)} is empty. Type the number, or tick “I can't read this”.` });
    else if (!DIGITS.test(v)) out.push({ key: k, message: `${figureLabel(k)}: use numbers only (0–9).` });
    else if (needsTick(f)) out.push({ key: k, message: tickMessage(figureLabel(k)) });
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
      `The sheet shows a different polling-unit code (${code}) from the unit you chose (${unitCode}). The unit is not changed. Check that you photographed the right sheet.`,
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
