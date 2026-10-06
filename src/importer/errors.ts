export type ImportErrorKind =
  | "DuplicateImport"
  | "DecodeError"
  | "HeaderValidationError"
  | "RowValidationError"
  | "DatabaseImportError";

export class ImportError extends Error {
  readonly kind: ImportErrorKind;
  readonly userMessage: string;
  readonly detail: string;

  constructor(kind: ImportErrorKind, userMessage: string, detail = userMessage) {
    super(detail);
    this.name = "ImportError";
    this.kind = kind;
    this.userMessage = userMessage;
    this.detail = detail;
  }
}

export function asImportError(error: unknown): ImportError {
  if (error instanceof ImportError) {
    return error;
  }

  const payload = parsePayload(error);
  if (payload) {
    return new ImportError(payload.kind, payload.userMessage, payload.detail);
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new ImportError(
    "DatabaseImportError",
    "データベースへの取り込みに失敗しました。",
    detail,
  );
}

function parsePayload(error: unknown): {
  kind: ImportErrorKind;
  userMessage: string;
  detail: string;
} | null {
  let candidate: unknown = error;
  if (typeof error === "string") {
    try {
      candidate = JSON.parse(error);
    } catch {
      return null;
    }
  }

  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  if (
    isImportErrorKind(record.kind) &&
    typeof record.userMessage === "string" &&
    typeof record.detail === "string"
  ) {
    return {
      kind: record.kind,
      userMessage: record.userMessage,
      detail: record.detail,
    };
  }
  return null;
}

function isImportErrorKind(value: unknown): value is ImportErrorKind {
  return (
    value === "DuplicateImport" ||
    value === "DecodeError" ||
    value === "HeaderValidationError" ||
    value === "RowValidationError" ||
    value === "DatabaseImportError"
  );
}
