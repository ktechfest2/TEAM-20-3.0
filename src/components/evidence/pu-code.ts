/** Polling-unit codes compared case-insensitively, ignoring dots, spaces and other punctuation. */
export const normalisePuCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The sheet code when it differs from the chosen unit's code, else null. */
export function sheetCodeMismatch(sheet: string | null | undefined, unitCode: string): string | null {
  if (!sheet || !sheet.trim()) return null;
  return normalisePuCode(sheet) === normalisePuCode(unitCode) ? null : sheet.trim();
}
