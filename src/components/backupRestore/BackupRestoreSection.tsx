import { useState } from "react";

import {
  BackupRestoreError,
  type BackupRestoreServicePort,
  type BackupResult,
  type RestoreCandidate,
} from "../../backupRestore";

interface BackupRestoreSectionProps {
  service: BackupRestoreServicePort;
}

export function BackupRestoreSection({ service }: BackupRestoreSectionProps) {
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [message, setMessage] = useState<DisplayMessage | null>(null);
  const [operation, setOperation] = useState<"backup" | "select" | "restore" | null>(null);

  async function createBackup() {
    if (operation) return;
    setOperation("backup");
    setMessage(null);
    setBackupResult(null);
    try {
      const result = await service.createBackup();
      if (result) setBackupResult(result);
    } catch (error: unknown) {
      console.error("Database backup failed", error);
      setMessage(displayError(error, "バックアップを作成できませんでした。"));
    } finally {
      setOperation(null);
    }
  }

  async function selectRestore() {
    if (operation) return;
    setOperation("select");
    setMessage(null);
    setCandidate(null);
    try {
      const selected = await service.selectRestoreBackup();
      if (selected) setCandidate(selected);
    } catch (error: unknown) {
      console.error("Restore backup validation failed", error);
      setMessage(displayError(error, "バックアップファイルを検証できませんでした。"));
    } finally {
      setOperation(null);
    }
  }

  async function restore() {
    if (!candidate || operation) return;
    setOperation("restore");
    setMessage(null);
    try {
      const result = await service.restore(candidate);
      if (result.restartRequested) {
        setMessage({ kind: "success", text: "復元が完了しました。アプリケーションを再起動します。" });
      }
    } catch (error: unknown) {
      console.error("Database restore failed", error);
      setMessage(displayError(error, "復元に失敗しました。現在のデータは維持されています。"));
      setOperation(null);
    }
  }

  const busy = operation !== null;
  return (
    <section className="backup-restore-section" aria-labelledby="backup-restore-title">
      <div className="section-heading">
        <div>
          <h3 id="backup-restore-title">データのバックアップと復元</h3>
          <p>プロフィール・進捗・マスターデータを含むSQLiteデータベース全体を扱います。</p>
        </div>
      </div>
      <div className="backup-restore-grid">
        <article className="data-safety-card">
          <h4>バックアップ</h4>
          <p>実行中のデータベースから、整合性を検証したスナップショットを保存します。</p>
          <button type="button" className="button primary" disabled={busy} onClick={() => void createBackup()}>
            {operation === "backup" ? "バックアップを作成中…" : "バックアップを作成"}
          </button>
          {backupResult && (
            <div className="import-success" role="status">
              <strong>バックアップを作成しました。</strong>
              <p>{backupResult.fileName}（{formatBytes(backupResult.sizeBytes)}）</p>
            </div>
          )}
        </article>
        <article className="data-safety-card">
          <h4>復元</h4>
          <p>検証済みバックアップで現在のデータベース全体を置き換えます。</p>
          <button type="button" className="button secondary" disabled={busy} onClick={() => void selectRestore()}>
            {operation === "select" ? "バックアップを検証中…" : "復元するファイルを選択"}
          </button>
          {candidate && (
            <div className="restore-confirmation" role="dialog" aria-labelledby="restore-confirm-title">
              <h4 id="restore-confirm-title">バックアップから復元しますか？</h4>
              <p><strong>{candidate.fileName}</strong>（{formatBytes(candidate.sizeBytes)}、schema version {candidate.migrationVersion}）</p>
              <p>現在のプロフィール、クエスト進捗、発見物進捗、マスターデータはバックアップ時点の内容に置き換わります。この操作の後、アプリケーションを再起動します。</p>
              <div className="import-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => setCandidate(null)}>キャンセル</button>
                <button type="button" className="button danger" disabled={busy} onClick={() => void restore()}>
                  {operation === "restore" ? "復元中…" : "復元する"}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
      {operation && <p className="import-running" role="status">{operation === "restore" ? "データベースを復元中です。アプリを終了しないでください…" : "処理中です。操作せずお待ちください…"}</p>}
      {message && <div className={message.kind === "error" ? "import-error" : "import-success"} role={message.kind === "error" ? "alert" : "status"}><strong>{message.text}</strong></div>}
    </section>
  );
}

interface DisplayMessage { kind: "error" | "success"; text: string }

function displayError(error: unknown, fallback: string): DisplayMessage {
  return {
    kind: "error",
    text: error instanceof BackupRestoreError ? error.userMessage : fallback,
  };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value.toLocaleString("ja-JP")} bytes`;
  return `${(value / 1024 / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} MB`;
}
