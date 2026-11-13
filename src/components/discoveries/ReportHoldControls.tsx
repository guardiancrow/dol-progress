import { useEffect, useRef, useState, type ReactNode } from "react";
import { currentState, stateLabels, stateOrder, meritReference } from "../../discoveries/stateReader";
import type { ReportHoldController } from "../../discoveries/useReportHold";
import type { DiscoveryStateOperation, MapCurrentState } from "../../discoveries/stateService";

export function DiscoveryStateControl({ id, name, controller: c, mapId = null, disabled = false, discoveryMapMode = false }: {
  id: number; name: string; controller: ReportHoldController; mapId?: number | null; disabled?: boolean; discoveryMapMode?: boolean;
}) {
  const s = c.summaries.get(id);
  if (!s) return <span>{c.loading ? "読込中" : "要確認"}</span>;
  if (s.categoryName === "レリック") return <span>対象外</span>;
  const state = currentState(s);
  if(s.automaticReporting) return <span>{s.discovered ? "報告済み（自動）" : "未発見"}</span>;
  return <select className="map-state-select" aria-label={`${name}の${discoveryMapMode ? "地図の状態" : "発見・報告状態"}`} data-report-focus={`${mapId ?? "d"}-${id}`}
    value={state} disabled={disabled || c.loading || c.busy || c.dialog !== null || !s.active}
    title={!s.active ? "非アクティブな発見物です" : discoveryMapMode ? "この発見物の発見・報告状態を変更します。同じ発見物に対応する地図は状態を共有します。" : "関連発見物の現在の発見・報告状態を変更します"}
    onChange={e=>{const target=e.target.value as MapCurrentState;e.currentTarget.value=state;void c.open(id,name,target,mapId,e.currentTarget,discoveryMapMode);}}>
    {stateOrder.map(value=><option key={value} value={value}>{stateLabels[value]}</option>)}
  </select>;
}

export function ReportHoldFeedback({ controller: c }: { controller: ReportHoldController }) {
  return <>
    {c.busy && <div className="progress-feedback" role="status">状態を確認・保存しています…</div>}
    {c.error && <div className="error-banner" role="alert">{c.error}<button type="button" className="button secondary" disabled={c.busy || c.loading} onClick={() => void c.retry()}>再読み込み</button></div>}
    {c.notice && <div className="progress-feedback" role="status">{c.notice}</div>}
  </>;
}

function Modal({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose(): void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div className="dialog-backdrop"><div ref={ref} className="dialog-card report-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
    onKeyDown={e => {
      if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); }
      if (e.key !== "Tab") return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
    }}><h2>{title}</h2>{children}</div></div>;
}

export function ReportHoldDialogs({ controller: c }: { controller: ReportHoldController }) {
  const d = c.dialog;
  if (!d) return c.selection ? <Modal title={c.selection.name} busy={c.busy} onClose={c.close}>
    <div className="map-related-dialog">{c.selection.targets.map(t=><label key={t.id}>{t.name}<DiscoveryStateControl id={t.id} name={t.name} controller={c} /></label>)}</div>
    <div className="dialog-actions"><button className="button secondary" onClick={c.close}>閉じる</button></div>
  </Modal> : null;
  return <Modal key={`${d.kind}-${d.snapshot.profileId}-${d.snapshot.discoveryId}`} title={`${d.name}の${d.kind === "history" ? "初回報告履歴の訂正" : "状態変更を確認"}`} busy={c.busy} onClose={c.close}>
    {d.kind === "confirm" ? <>
      <p>{d.message}</p>
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={c.busy} onClick={c.close}>キャンセル</button>
        <button type="button" className="button primary" disabled={c.busy} onClick={() => void c.save(d)}>記録を保存</button></div>
    </> : <HistoryForm controller={c} />}
  </Modal>;
}

function HistoryForm({ controller: c }: { controller: ReportHoldController }) {
  const d = c.dialog!;
  const s = d.snapshot;
  type Choice = "confirmed" | "not_reported" | "";
  const initial = d.initialHistoryStatus ?? s.history?.status;
  const [status, setStatus] = useState<Choice>(initial === "confirmed" || initial === "not_reported" ? initial : "");
  const [current, setCurrent] = useState<"keep" | "undiscovered" | "unreported">("keep");
  const needsCurrentCorrection = status === "not_reported" && Boolean(s.progress?.reported);
  const currentChange = needsCurrentCorrection ? current : "keep";
  const before = s.history?.status === "confirmed" || Boolean(s.history?.legacyMeritCredit);
  const after = status === "confirmed";
  const exp = c.summaries.get(s.discoveryId)?.experience;
  const reference = meritReference(c.summaries.values());
  const impact = before === after ? "冒険勲功値の算入資格は変わりません。" : exp == null
    ? `経験値不明の算入対象が${after ? "1件増え" : "1件減り"}ます。判明分の合計は変わりません。`
    : `冒険勲功値（判明分）は${after ? "+" : "−"}${exp}、算入対象は${after ? "+1" : "−1"}件となります。`;
  const unchanged = status === s.history?.status && currentChange === "keep";
  const allowed = s.active && !s.automaticReporting && s.categoryName !== "レリック";
  return <>
    {d.initialHistoryStatus ? <p>初回報告を「{status === "confirmed" ? "報告済み" : "報告前"}」へ訂正します。</p> :
      <label>初回報告履歴<select aria-label="初回報告履歴" value={status} disabled={c.busy} onChange={e => setStatus(e.target.value as Choice)}>
        <option value="" disabled>選択してください</option>
        <option value="confirmed">初回報告済み</option><option value="not_reported">初回報告前</option>
      </select></label>}
    {status === "not_reported" && <>
      <p>{s.history?.status === "confirmed"
        ? "過去の報告実績を取り消す訂正です。再発見後も初回報告済みなら、チェックは外さず現在状態だけ未報告にしてください。"
        : "初回報告をまだ行っていないことを記録します。"}</p>
      {s.history?.legacyMeritCredit && <p>この訂正で、旧データから引き継いだ冒険勲功値の算入資格を解除します。</p>}
    </>}
    {needsCurrentCorrection && <label>現在進捗の同時訂正<select aria-label="現在進捗の同時訂正" value={current} disabled={c.busy} onChange={e => setCurrent(e.target.value as typeof current)}>
      <option value="keep">訂正方法を選択してください</option><option value="unreported">未報告へ訂正</option>
      <option value="undiscovered">未発見へ訂正（現在進捗を削除）</option>
    </select></label>}
    {needsCurrentCorrection && current === "keep" && <p role="alert">現在報告済みのまま初回報告前にはできません。現在状態の訂正方法を選んでください。</p>}
    {currentChange === "undiscovered" ? <p>現在進捗・カード所有・発見物メモ・維持設定を削除します。クエスト達成は保持します。</p> :
      currentChange === "unreported" ? <p>現在の報告状態も未報告へ訂正します。カード所有・メモ・クエスト達成は保持します。</p> : null}
    {status && <p role="status">{impact}</p>}
    {status && before !== after && exp != null && <p>冒険勲功値（判明分）：{reference.known.toLocaleString("ja-JP")} → {(reference.known + (Number(after)-Number(before)) * exp).toLocaleString("ja-JP")}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" disabled={c.busy} onClick={c.close}>キャンセル</button>
      <button type="button" className="button primary" disabled={c.busy || !allowed || !status || unchanged || needsCurrentCorrection && current === "keep"} onClick={() => {
        if (!status) return;
        const operation: DiscoveryStateOperation = {kind:"correctHistory",status,removeLegacyCredit:false,currentState:currentChange === "keep" ? null : currentChange};
        void c.save({...d,operation});
      }}>記録を保存</button>
    </div>
  </>;
}
