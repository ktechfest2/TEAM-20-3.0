/**
 * Temporary ANALYSIS COPY of an evidence photo for the vision model.
 * The original bytes are never modified, re-encoded or sent anywhere by this module: we copy them
 * into a new Buffer, then rotate (EXIF orientation), shrink (long edge ≤ 1568 px), re-encode as
 * JPEG q85 and strip all metadata (sharp drops EXIF/GPS/ICC unless asked to keep it).
 * The copy's SHA-256 is recorded separately and must never be confused with the original's hash.
 */
import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ExtractionError } from "./errors";

export const ANALYSIS_MAX_EDGE = 1568;
export const ANALYSIS_JPEG_QUALITY = 85;

export interface AnalysisCopy {
  bytes: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  sizeBytes: number;
  /** SHA-256 of the ANALYSIS COPY (not the original evidence). */
  sha256: string;
}

/** Metadata safe to store in raw extraction output (no pixels). */
export type AnalysisCopyMeta = Omit<AnalysisCopy, "bytes"> & { kind: "ANALYSIS_COPY" };

export function analysisCopyMeta(c: AnalysisCopy): AnalysisCopyMeta {
  return { kind: "ANALYSIS_COPY", mime: c.mime, width: c.width, height: c.height, sizeBytes: c.sizeBytes, sha256: c.sha256 };
}

export async function makeAnalysisCopy(original: Uint8Array): Promise<AnalysisCopy> {
  const input = Buffer.from(original); // defensive copy; the original is never touched
  try {
    const { data, info } = await sharp(input, { failOn: "error" })
      .rotate()
      .resize({
        width: ANALYSIS_MAX_EDGE,
        height: ANALYSIS_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: ANALYSIS_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      mime: "image/jpeg",
      width: info.width,
      height: info.height,
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch {
    throw new ExtractionError(
      "UNSUPPORTED_DOCUMENT",
      "This file could not be opened as an image. Enter the figures by hand.",
    );
  }
}
