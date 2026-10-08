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
    try { await dataRootService.migrateSelected(); setMessage("データベースの保存場所を変更しました。アプリを再起動します。"); }
    catch (cause) { setError(`移行できませんでした。元データは保持されています。現在: ${info.dataRoot}\n${userFacingDataRootError(cause, "移行先とデータベースの状態を確認してから、もう一度実行してください。")}`); }
    finally { setBusy(false); }
  }
  async function migrateDefault() {
    if (info.defaultDatabaseExists && !window.confirm("以前の標準データベースは安全コピーとして残します。現在のデータを標準保存場所へ移行しますか？")) return;
    setBusy(true); setError(undefined);
    try { await dataRootService.migrateToDefault(); setMessage("データベースの保存場所を変更しました。アプリを再起動します。"); }
    catch (cause) { setError(`移行できませんでした。元データは保持されています。現在: ${info.dataRoot}\n${userFacingDataRootError(cause, "標準保存場所とデータベースの状態を確認してから、もう一度実行してください。")}`); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="page-heading"><div><p className="page-eyebrow">Data root</p><h2>データ保存場所</h2><p>データベースと設定の保存場所を確認できます。</p></div></div>
    {message && <p className="success-banner">{message}</p>}{error && <p className="error-banner">{error}</p>}
    <div className="backup-restore-grid">
      <article className="data-safety-card" aria-labelledby="database-storage-title">
        <h3 id="database-storage-title">データベース</h3>
        <dl className="master-status-list">
          <div><dt>データベースのフォルダー</dt><dd>{info.dataRoot}</dd></div>
        </dl>
        {info.mode === "custom" && <p>カスタム保存先を使用しています。</p>}
        <h4>データベースの保存場所を変更</h4>
        <p>データベースの保存先には、次の条件を満たすフォルダーを選んでください。</p>
        <ul>
          <li>Windowsのローカル固定ドライブ上にあるNTFSフォルダー</li>
          <li>書き込み可能</li>
          <li>空のフォルダー</li>
          <li>アプリのフォルダー、その親フォルダー、配下のフォルダーではない</li>
          <li>現在のデータベースのフォルダーや、その親・配下のフォルダーではない</li>
          <li>ドライブのルートやProgram Files配下ではない</li>
          <li>保存先までのパスにジャンクションやシンボリックリンクを含まない</li>
        </ul>
        <p>移行後も元のデータベースは削除されません。</p>
        {selected ? <><p className="storage-path">選択したデータベースの移行先: {selected}</p><p>データベースの移行先を確認してから、次のボタンで移行を開始します。</p><button className="button primary" disabled={busy} onClick={migrateCustom} type="button">このフォルダーへデータベースを移行する</button><button className="button secondary data-root-action" disabled={busy} onClick={chooseCustom} type="button">データベースの移行先を選び直す</button></> : <button className="button primary" disabled={busy} onClick={chooseCustom} type="button">データベースの保存場所を変更</button>}
        {info.mode === "custom" && <button className="button secondary data-root-action" disabled={busy} onClick={migrateDefault} type="button">データベースを標準保存場所へ戻す</button>}
        {busy && <p className="import-running">データベースを移行しています...</p>}
      </article>
      <article className="data-safety-card" aria-labelledby="app-settings-title">
        <h3 id="app-settings-title">アプリの設定</h3>
        <dl className="master-status-list">
          <div><dt>設定フォルダー</dt><dd>{info.configRoot}</dd></div>
        </dl>
        <p>設定フォルダーにはアプリの設定が保存されます。</p>
      </article>
    </div>
    <div className="backup-restore-grid portable-storage-guide">
      <article className="data-safety-card" aria-labelledby="storage-management-title">
        <h3 id="storage-management-title">データとアプリの管理</h3>
        <h4>データベースのバックアップ</h4>
        <p>バックアップを作成するときは「マスターデータ」のページから行ってください。</p>
        <h4>ファイルの移動と編集</h4>
        <p>アプリの起動中に、ファイルやフォルダーを手動で移動しないでください。データや設定ファイルは手動で編集しないでください。</p>
        <h4>アプリを削除するとき</h4>
        <p>アプリを終了してから、実行ファイルを削除します。アンインストーラーはありません。</p>
        <p className="storage-warning">データベースや設定も削除する場合は、必要なバックアップを確認してからそれぞれの保存先を削除してください。</p>
      </article>
      <article className="data-safety-card" aria-labelledby="windows-storage-title">
        <h3 id="windows-storage-title">Windows側に残るデータ</h3>
        <p>このアプリケーションはMicrosoft Edge WebView2 Runtimeを使用しています。</p>
        <p>WebView2のキャッシュ等はWindows側のユーザーデータ領域（LocalAppData）に残る場合があります。</p>
      </article>
    </div>
  </section>;
}
