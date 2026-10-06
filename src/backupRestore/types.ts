export type BackupRestoreErrorKind =
  | "BackupCancelled"
  | "BackupFailed"
  | "BackupValidationFailed"
  | "RestoreCancelled"
  | "InvalidBackup"
  | "IncompatibleBackup"
  | "RestoreFailed";

export interface BackupResult {
  fileName: string;
  sizeBytes: number;
}

export interface RestoreCandidate {
  token: string;
  fileName: string;
  sizeBytes: number;
  migrationVersion: number;
}

export interface RestoreResult {
  restartRequested: boolean;
}

export interface BackupRestoreServicePort {
  createBackup(): Promise<BackupResult | null>;
  selectRestoreBackup(): Promise<RestoreCandidate | null>;
  restore(candidate: RestoreCandidate): Promise<RestoreResult>;
}
