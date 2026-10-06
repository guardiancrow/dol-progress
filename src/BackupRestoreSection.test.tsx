// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupRestoreError, type BackupRestoreServicePort, type RestoreCandidate } from "./backupRestore";
import { BackupRestoreSection } from "./components/backupRestore/BackupRestoreSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Backup / Restore UI", () => {
  it("treats backup destination cancel as a no-op", async () => {
    const service = mockService();
    service.createBackup.mockResolvedValue(null);
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "バックアップを作成" }));
    await waitFor(() => expect(service.createBackup).toHaveBeenCalledOnce());
    expect(screen.queryByText("バックアップを作成しました。")).not.toBeInTheDocument();
  });

  it("shows the verified backup filename and size", async () => {
    const service = mockService();
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "バックアップを作成" }));
    expect(await screen.findByText("バックアップを作成しました。")).toBeInTheDocument();
    expect(screen.getByText(/dol-progress-backup\.sqlite3/)).toHaveTextContent("2 MB");
  });

  it("disables duplicate operations while backup is pending", async () => {
    const service = mockService();
    let resolve: (() => void) | undefined;
    service.createBackup.mockImplementation(() => new Promise((done) => { resolve = () => done(null); }));
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "バックアップを作成" }));
    expect(screen.getByRole("button", { name: "バックアップを作成中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "復元するファイルを選択" })).toBeDisabled();
    resolve?.();
  });

  it("does nothing when the restore picker is cancelled", async () => {
    const service = mockService();
    service.selectRestoreBackup.mockResolvedValue(null);
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "復元するファイルを選択" }));
    await waitFor(() => expect(service.selectRestoreBackup).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation after validation", async () => {
    const service = mockService();
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "復元するファイルを選択" }));
    const dialog = await screen.findByRole("dialog", { name: "バックアップから復元しますか？" });
    expect(dialog).toHaveTextContent("verified.sqlite3");
    expect(dialog).toHaveTextContent("schema version 1");
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("confirmation cancel does not restore", async () => {
    const service = mockService();
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "復元するファイルを選択" }));
    await user.click(await screen.findByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("restores the selected token and announces restart", async () => {
    const service = mockService();
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "復元するファイルを選択" }));
    await user.click(await screen.findByRole("button", { name: "復元する" }));
    expect(service.restore).toHaveBeenCalledWith(service.candidate);
    expect(await screen.findByText("復元が完了しました。アプリケーションを再起動します。")).toBeInTheDocument();
  });

  it.each([
    ["InvalidBackup", "有効なバックアップではありません。"],
    ["IncompatibleBackup", "このバックアップは新しすぎます。"],
    ["RestoreFailed", "バックアップを検証できませんでした。"],
  ] as const)("shows %s safely before confirmation", async (kind, message) => {
    const service = mockService();
    service.selectRestoreBackup.mockRejectedValue(new BackupRestoreError(kind, message, "developer detail SQL"));
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "復元するファイルを選択" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent("developer detail SQL");
  });

  it("shows backup validation failure without claiming success", async () => {
    const service = mockService();
    service.createBackup.mockRejectedValue(new BackupRestoreError("BackupValidationFailed", "作成したバックアップの検証に失敗しました。", "quick_check failed"));
    const user = open(service);
    await user.click(screen.getByRole("button", { name: "バックアップを作成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作成したバックアップの検証に失敗しました。");
    expect(screen.queryByText("バックアップを作成しました。")).not.toBeInTheDocument();
  });
});

function open(service: MockService) {
  const user = userEvent.setup();
  render(<BackupRestoreSection service={service} />);
  return user;
}

interface MockService extends BackupRestoreServicePort {
  createBackup: ReturnType<typeof vi.fn>;
  selectRestoreBackup: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  candidate: RestoreCandidate;
}

function mockService(): MockService {
  const candidate: RestoreCandidate = {
    token: "token",
    fileName: "verified.sqlite3",
    sizeBytes: 2048,
    migrationVersion: 1,
  };
  return {
    candidate,
    createBackup: vi.fn().mockResolvedValue({ fileName: "dol-progress-backup.sqlite3", sizeBytes: 2 * 1024 * 1024 }),
    selectRestoreBackup: vi.fn().mockResolvedValue(candidate),
    restore: vi.fn().mockResolvedValue({ restartRequested: true }),
  };
}
