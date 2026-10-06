import { describe, expect, it, vi } from "vitest";

import { BackupRestoreError } from "./errors";
import { BackupRestoreService } from "./backupRestoreService";
import type { RestoreCandidate } from "./types";

const candidate: RestoreCandidate = {
  token: "selected-token",
  fileName: "backup.sqlite3",
  sizeBytes: 1024,
  migrationVersion: 1,
};

describe("BackupRestoreService", () => {
  it("returns null when the backup destination dialog is cancelled", async () => {
    const command = vi.fn().mockResolvedValue(null);
    const service = new BackupRestoreService(command);

    await expect(service.createBackup()).resolves.toBeNull();
    expect(command).toHaveBeenCalledWith("create_database_backup");
  });

  it("returns a validated restore candidate or null on picker cancel", async () => {
    const command = vi.fn().mockResolvedValueOnce(candidate).mockResolvedValueOnce(null);
    const service = new BackupRestoreService(command);

    await expect(service.selectRestoreBackup()).resolves.toEqual(candidate);
    await expect(service.selectRestoreBackup()).resolves.toBeNull();
    expect(command).toHaveBeenCalledWith("select_restore_backup");
  });

  it("delegates pool lifecycle and replacement to the Rust restore command", async () => {
    const command = vi.fn().mockResolvedValue({ restartRequested: true });
    const service = new BackupRestoreService(command);

    await expect(service.restore(candidate)).resolves.toEqual({ restartRequested: true });

    expect(command).toHaveBeenCalledWith("restore_database_backup", { token: "selected-token" });
  });

  it("preserves structured Rust error kinds and separates developer detail", async () => {
    const command = vi.fn().mockRejectedValue({
      kind: "IncompatibleBackup",
      userMessage: "互換性がありません。",
      detail: "future migration 99",
    });
    const service = new BackupRestoreService(command);

    await expect(service.selectRestoreBackup()).rejects.toEqual(
      new BackupRestoreError("IncompatibleBackup", "互換性がありません。", "future migration 99"),
    );
  });
});
