import type { BackupRestoreErrorKind } from "./types";

export class BackupRestoreError extends Error {
  constructor(
    readonly kind: BackupRestoreErrorKind,
    readonly userMessage: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "BackupRestoreError";
  }
}

interface CommandErrorPayload {
  kind?: unknown;
  userMessage?: unknown;
  detail?: unknown;
}

const KINDS = new Set<BackupRestoreErrorKind>([
  "BackupCancelled",
  "BackupFailed",
  "BackupValidationFailed",
  "RestoreCancelled",
  "InvalidBackup",
  "IncompatibleBackup",
  "RestoreFailed",
]);

export function toBackupRestoreError(
  error: unknown,
  fallbackKind: "BackupFailed" | "RestoreFailed",
): BackupRestoreError {
  if (error instanceof BackupRestoreError) return error;
  if (typeof error === "object" && error !== null) {
    const payload = error as CommandErrorPayload;
    if (
      typeof payload.kind === "string" &&
      KINDS.has(payload.kind as BackupRestoreErrorKind) &&
      typeof payload.userMessage === "string"
    ) {
      return new BackupRestoreError(
        payload.kind as BackupRestoreErrorKind,
        payload.userMessage,
        typeof payload.detail === "string" ? payload.detail : payload.userMessage,
      );
    }
  }
  return new BackupRestoreError(
    fallbackKind,
    fallbackKind === "BackupFailed"
      ? "バックアップを作成できませんでした。"
      : "バックアップから復元できませんでした。現在のデータは維持されています。",
    error instanceof Error ? error.message : String(error),
  );
}
