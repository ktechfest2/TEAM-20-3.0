/**
 * File-signature (magic byte) detection. The client-declared MIME type and file
 * name are never trusted. We do not decode images (no decompression-bomb surface).
 */
import type { ACCEPTED_MIME } from "@/lib/contracts";

export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

export function detectImageMime(bytes: Uint8Array): AcceptedMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export const extensionFor = (mime: AcceptedMime) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mime];
