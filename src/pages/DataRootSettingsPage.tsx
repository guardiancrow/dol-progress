import { useState } from "react";

import { dataRootService, type DataRootInfo } from "../dataRoot/service";

function userFacingDataRootError(cause: unknown, fallback: string): string {
  const message = String(cause);
  return /保存場所|ディレクトリ|フォルダー|NTFS|ネットワーク|ドライブ|Program Files|ジャンクション|シンボリックリンク|同じ/.test(message)
    ? message
    : fallback;
}

export function DataRootSettingsPage({ info }: { info: DataRootInfo }) {
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function chooseCustom() {
    setError(undefined);
    try {
      const path = await dataRootService.chooseCustom();
      setSelected(path ?? undefined);
      if (path) setMessage(undefined);
    } catch (cause) {
      setSelected(undefined);
      setError(`選択したフォルダーは使用できません。理由: ${userFacingDataRootError(cause, "保存場所の状態または書き込み権限を確認してください。")}`);
    }
  }
  async function migrateCustom() {
    setBusy(true); setError(undefined);
    try { await dataRootService.migrateSelected(); setMessage("保存場所を変更しました。アプリを再起動します。"); }
    catch (cause) { setError(`移行できませんでした。元データは保持されています。現在: ${info.dataRoot}\n${userFacingDataRootError(cause, "移行先とデータベースの状態を確認してから、もう一度実行してください。")}`); }
    finally { setBusy(false); }
  }
  async function migrateDefault() {
    if (info.defaultDatabaseExists && !window.confirm("以前の標準データベースは安全コピーとして残します。現在のデータを標準保存場所へ移行しますか？")) return;
    setBusy(true); setError(undefined);
    try { await dataRootService.migrateToDefault(); setMessage("保存場所を変更しました。アプリを再起動します。"); }
    catch (cause) { setError(`移行できませんでした。元データは保持されています。現在: ${info.dataRoot}\n${userFacingDataRootError(cause, "標準保存場所とデータベースの状態を確認してから、もう一度実行してください。")}`); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="page-heading"><div><p className="page-eyebrow">Data root</p><h2>データ保存場所</h2><p>アプリは表示中の1つのデータベースだけを使用します。</p></div></div>
    {message && <p className="success-banner">{message}</p>}{error && <p className="error-banner">{error}</p>}
    <div className="data-safety-card">
      <dl className="master-status-list"><div><dt>モード</dt><dd>{info.mode === "custom" ? "カスタム" : "標準"}</dd></div><div><dt>現在の保存場所</dt><dd>{info.dataRoot}</dd></div><div><dt>データベース</dt><dd>{info.databasePath}</dd></div></dl>
      {selected ? <><p>選択した移行先: {selected}</p><p>移行先を確認してから、次のボタンでデータ移行を開始します。</p><button className="button primary" disabled={busy} onClick={migrateCustom} type="button">この保存場所へ移行する</button><button className="button secondary data-root-action" disabled={busy} onClick={chooseCustom} type="button">選び直す</button></> : <button className="button primary" disabled={busy} onClick={chooseCustom} type="button">保存場所を変更...</button>}
      {info.mode === "custom" && <button className="button secondary data-root-action" disabled={busy} onClick={migrateDefault} type="button">標準保存場所へ戻す</button>}
      {busy && <p className="import-running">データを移行しています...</p>}
    </div>
  </section>;
}
