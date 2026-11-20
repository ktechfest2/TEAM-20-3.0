/**
 * Stable error codes for extraction. The API layer maps them to HTTP responses; the UI always
 * offers manual entry after any of them. Messages are plain language and never include secrets.
 */
export type ExtractionErrorCode =
  | "MODE_UNAVAILABLE"
  | "INVALID_DRAFT"
  | "NOT_CONFIGURED"
  | "UNSUPPORTED_DOCUMENT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "REFUSED";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  /** Optional non-secret detail (e.g. the model's notes on why a document is unsupported). */
  readonly details: readonly string[];
  constructor(code: ExtractionErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    this.details = details;
  }
}
