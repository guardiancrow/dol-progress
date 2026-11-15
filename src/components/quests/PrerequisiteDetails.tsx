import { useLayoutEffect, useRef, useState } from "react";
import { canManuallyCompletePrerequisite, type PrerequisiteDetailsView } from "../../quests/prerequisiteDetails";
import type { PrerequisiteProgressCandidate, PrerequisiteProgressReviewState } from "../../quests/prerequisiteProgressReview";

export function PrerequisiteDetails({ view, review, locked, onBegin, onBeginManual, onReload }: {
  view: PrerequisiteDetailsView;
  review: PrerequisiteProgressReviewState;
  locked: boolean;
  onBegin?(candidate: PrerequisiteProgressCandidate, origin: HTMLButtonElement): void;
  onBeginManual?(contextQuestId: number, targetQuestId: number, origin: HTMLButtonElement): void;
  onReload?(): void;
}) {
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = view.data.quests.get(view.currentId);
  const direct = view.data.direct.get(view.currentId) ?? [];
  const ready = review.status === "ready";
  const reasons = view.data.reasons.get(view.currentId);
  useLayoutEffect(() => { heading.current?.focus(); }, [view.currentId]);
  if (!current) return <p role="status">対象のクエストを確認できません。閉じて再確認してください。</p>;
  const record = (id: number) => !ready ? "達成記録は未確認" : view.completed.has(id) ? "達成済みとして記録" : "未達成として記録";
  return <>
    <h4 ref={heading} tabIndex={-1} className="prerequisite-details-current">{current.title}の前提を確認</h4>
    <p>対象：{current.title}（GVDB ID: {current.gvdbId}／内部ID: {current.id}）／{record(current.id)}</p>
    <div className="prerequisite-review-actions">
      {view.canGoBack && <button type="button" className="button secondary" disabled={locked} onClick={view.onBack}>前の確認に戻る</button>}
      <button type="button" className="button secondary" disabled={locked || !ready} onClick={view.onRecheck}>前提を再確認</button>
    </div>
    {!ready && <p role="status">{review.status === "error" ? "達成記録を確認できません。再読み込みしてください。" : "達成記録を確認しています。"}
      {review.status === "error" && onReload && <button type="button" className="button secondary" disabled={locked} onClick={onReload}>前提の記録を再読み込み</button>}</p>}
    {ready && !view.recordedAtOpen && view.completed.has(current.id) && <p>候補による登録操作を行う前に「前提を再確認」を押してください。手動登録はゲーム内での達成をご自身で確認して行えます。</p>}
    {reasons === undefined ? <p>確認理由の診断結果を確認できません。</p> : reasons.length > 0 && <div><strong>要確認</strong><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    {view.cycleMessage && <p role="status">{view.cycleMessage}</p>}
    {direct.length === 0 ? <p>表示できる直接前提はありません。</p> : <ul className="prerequisite-review-list">
      {direct.slice(page * 20, (page + 1) * 20).map(previous => {
        const identity = view.data.quests.get(previous.id);
        const candidate = ready && view.recordedAtOpen && reasons !== undefined
          ? review.candidates.find(item => item.successor.id === current.id && item.prerequisite.id === previous.id) : undefined;
        const manual = ready && !candidate && canManuallyCompletePrerequisite(view.data, current.id, previous.id, view.completed);
        return <li key={previous.id}>
          <strong>{previous.name}</strong>{identity && <>（GVDB ID: {identity.gvdbId}／内部ID: {identity.id}）</>}／{record(previous.id)}
          {(view.data.recordReasons.get(previous.id) ?? []).map(reason => <span className="prerequisite-review-reason" key={reason}>要確認：{reason}</span>)}
          {candidate && onBegin && <>
            <span className="prerequisite-review-reason">確認理由：単一の直接前提に達成記録がありません。記録をご確認ください。</span>
            <button type="button" className="button secondary prerequisite-review-start" disabled={locked}
              onClick={event => onBegin(candidate, event.currentTarget)}>前提「{previous.name}」を達成済みにする…</button>
          </>}
          {manual && onBeginManual && <button type="button" className="button secondary prerequisite-review-start" disabled={locked}
            aria-label={`${previous.name}を手動で達成済みとして登録`}
            onClick={event => onBeginManual(current.id, previous.id, event.currentTarget)}>達成済みとして登録…</button>}
          {(view.data.direct.get(previous.id)?.length ?? 0) > 0 && <button type="button" className="button secondary prerequisite-details-next" disabled={locked}
            onClick={() => view.onOpen(previous.id)}>{previous.name}の前提を確認</button>}
        </li>;
      })}
    </ul>}
    {direct.length > 20 && <div className="prerequisite-review-pages" aria-label="直接前提のページ操作">
      <button type="button" className="button secondary" disabled={locked || page === 0} onClick={() => setPage(page - 1)}>前提の前ページ</button>
      <span>{page + 1} / {Math.ceil(direct.length / 20)}ページ</span>
      <button type="button" className="button secondary" disabled={locked || (page + 1) * 20 >= direct.length} onClick={() => setPage(page + 1)}>前提の次ページ</button>
    </div>}
  </>;
}
