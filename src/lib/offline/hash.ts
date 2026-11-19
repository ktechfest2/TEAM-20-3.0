/** SHA-256 of the exact original bytes, as lowercase hex. Web Crypto only. */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short human-readable fingerprint, e.g. "3f9a 1c07 … 88e2 b4d1". */
export function shortFingerprint(hex: string): string {
  const groups = hex.match(/.{4}/g) ?? [];
  if (groups.length <= 4) return groups.join(" ");
  return `${groups.slice(0, 2).join(" ")} … ${groups.slice(-2).join(" ")}`;
}

/** Full hash grouped in fours for reading aloud / comparing by eye. */
export function groupedHash(hex: string): string {
  return (hex.match(/.{4}/g) ?? []).join(" ");
}

/** Receipt number = first 8 hex of the clientSubmissionId, grouped. */
export function receiptNumber(clientSubmissionId: string): string {
  const hex = clientSubmissionId.replace(/-/g, "").slice(0, 8);
  return `${hex.slice(0, 4)} ${hex.slice(4)}`;
}
