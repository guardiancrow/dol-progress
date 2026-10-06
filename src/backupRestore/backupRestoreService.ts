import { invoke } from "@tauri-apps/api/core";

import { toBackupRestoreError } from "./errors";
import type {
  BackupRestoreServicePort,
  BackupResult,
  RestoreCandidate,
  RestoreResult,
} from "./types";

type InvokeCommand = typeof invoke;

export class BackupRestoreService implements BackupRestoreServicePort {
  constructor(
    private readonly command: InvokeCommand = invoke,
  ) {}

  async createBackup(): Promise<BackupResult | null> {
    try {
      return await this.command<BackupResult | null>("create_database_backup");
    } catch (error: unknown) {
      throw toBackupRestoreError(error, "BackupFailed");
    }
  }

  async selectRestoreBackup(): Promise<RestoreCandidate | null> {
    try {
      return await this.command<RestoreCandidate | null>("select_restore_backup");
    } catch (error: unknown) {
      throw toBackupRestoreError(error, "RestoreFailed");
    }
  }

  async restore(candidate: RestoreCandidate): Promise<RestoreResult> {
    try {
      return await this.command<RestoreResult>("restore_database_backup", {
        token: candidate.token,
      });
    } catch (error: unknown) {
      throw toBackupRestoreError(error, "RestoreFailed");
    }
  }
}
