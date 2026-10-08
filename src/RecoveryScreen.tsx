import { useState } from "react";
import { dataRootService, type RecoveryInfo } from "./dataRoot/service";

export function RecoveryScreen({ info }: { info: RecoveryInfo }) {
  const [selected, setSelected] = useState<string>(); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const genericError = "操作を完了できませんでした。保存場所とデータベースの状態を確認してください。";
  async function choose() { try { setError(undefined); setSelected((await dataRootService.chooseExisting()) ?? undefined); } catch { setError(genericError); } }
  async function activate() { setBusy(true); try { await dataRootService.activateExisting(); } catch { setError(genericError); setBusy(false); } }
  async function activateLastGood() { setBusy(true); try { await dataRootService.activateLastGood(); } catch { setError("最後に正常だった保存場所を確認できませんでした。保存場所を指定し直してください。"); setBusy(false); } }
  async function rollback() { setBusy(true); try { await dataRootService.rollbackPrevious(); } catch { setError("進行中の保存場所変更を戻せませんでした。保存場所を指定し直してください。"); setBusy(false); } }
  return <main className="recovery-screen"><section className="state-panel">
    <p className="page-eyebrow">Recovery</p><h2>設定されているデータ保存場所を開けません。</h2>
    <p className="storage-path">{info.configuredRoot ?? "保存場所設定を確認できません。"}</p>
    <p>データベースは別の場所へ自動作成されていません。</p>
    <p className="field-error">{info.message}</p>{error && <p className="field-error">{error}</p>}
    <p>保存場所を修正した後は、アプリを一度終了して起動し直してください。</p>
    <p>既存のカスタムデータベースを使う場合は、そのフォルダーを指定し、検証後に使用してください。</p>
    {selected && <p className="storage-path">選択した保存場所: {selected}</p>}
    <div className="recovery-actions">
      <button className="button secondary" disabled={busy} onClick={choose}>保存場所を指定し直す</button>
      {selected && <button className="button primary" disabled={busy} onClick={activate}>検証済みの保存場所を使用する</button>}
      {info.lastGoodAvailable && <button className="button secondary" disabled={busy} onClick={activateLastGood}>最後に正常だった保存場所を使用する</button>}
      {info.pendingPreviousAvailable && <button className="button secondary" disabled={busy} onClick={rollback}>進行中の変更前の保存場所へ戻す</button>}
      <button className="button danger-quiet" disabled={busy} onClick={() => window.close()}>アプリを終了</button>
    </div>
  </section></main>;
}
