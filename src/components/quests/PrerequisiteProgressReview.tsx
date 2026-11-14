import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PrerequisiteProgressReviewState } from "../../quests/prerequisiteProgressReview";
import type { PrerequisiteReviewCompletion } from "../../quests/prerequisiteReviewCompletion";

interface Props {
  id: string;
  expanded: boolean;
  panelRef: RefObject<HTMLElement | null>;
  review: PrerequisiteProgressReviewState;
  matchingCount: number;
  onlyCandidates: boolean;
  onOnlyCandidates(value: boolean): void;
  onClose(): void;
  onReload?(): void;
  completion?: PrerequisiteReviewCompletion;
}

export function PrerequisiteProgressReview({ id, expanded, panelRef, review, matchingCount, onlyCandidates, onOnlyCandidates, onClose, onReload, completion }: Props) {
  const [page, setPage] = useState(0);
  const confirmationId = useId();
  const confirmationRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const lastConfirmationFocus = useRef<HTMLElement | null>(null);
  const confirmation = completion?.confirmation;
  useLayoutEffect(() => {
    if (expanded && confirmation) {
      confirmationRef.current?.focus({ preventScroll: true });
      confirmationRef.current?.scrollIntoView?.({ block: "start", inline: "nearest" });
    }
    else if (!confirmation && expanded && lastConfirmationFocus.current && !lastConfirmationFocus.current.isConnected
      && document.activeElement === document.body) {
      const origin = originRef.current;
      if (origin?.isConnected) origin.focus();
      else closeRef.current?.focus();
      lastConfirmationFocus.current = null;
    }
  }, [confirmation, expanded]);
  function cancelConfirmation() {
    if (completion?.pending) return;
    completion?.cancel();
    if (originRef.current?.isConnected) originRef.current.focus();
    else closeRef.current?.focus();
  }
  const candidates = review.status === "ready" ? review.candidates : [];
  const pageCount = Math.ceil(candidates.length / 20);
  useEffect(() => {
    if (review.status === "ready") setPage(current => Math.min(current, Math.max(0, pageCount - 1)));
  }, [review.status, pageCount]);
  return <section id={id} ref={panelRef} hidden={!expanded} tabIndex={0} className="prerequisite-review" aria-label="前提クエストの進捗確認候補">{expanded && <>
    <div className="prerequisite-review-heading"><h3>前提クエストの進捗確認候補</h3>
      <button type="button" className="button secondary" ref={closeRef} onClick={() => { completion?.cancel(); onClose(); }} aria-label="確認候補の詳細を閉じる">閉じる</button>
    </div>
    {confirmation && <div className="prerequisite-review-confirmation" ref={confirmationRef} role="group" tabIndex={-1}
      aria-labelledby={`${confirmationId}-title`} aria-describedby={`${confirmationId}-description`} aria-busy={completion?.pending}
      onFocusCapture={event => { lastConfirmationFocus.current = event.target; }}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !completion?.pending) { event.preventDefault(); event.stopPropagation(); cancelConfirmation(); } }}>
      <h4 id={`${confirmationId}-title`}>前提クエストの達成登録</h4>
      <div id={`${confirmationId}-description`}>
        <p>プロフィール「{confirmation.profileName}」の前提「{confirmation.candidate.prerequisite.title}」（GVDB ID: {confirmation.candidate.prerequisite.gvdbId}）を達成済みにします。現在は未達成として記録されています。</p>
        <p>通常一覧と同じ達成処理を使用します。関連する未発見の発見物も、既存の連動条件に従って発見済みになる場合があります。他の前提クエストは登録しません。</p>
      </div>
      <div className="prerequisite-review-actions">
        <button type="button" className="button secondary" disabled={completion?.pending} onClick={cancelConfirmation}>キャンセル</button>
        <button type="button" className="button" disabled={completion?.pending} onClick={() => { void completion?.confirm(); }}>達成済みにする</button>
        {completion?.pending && <span role="status">保存結果を確認しています…</span>}
      </div>
    </div>}
    {completion?.message && <p role="status">{completion.message}</p>}
    <p>保存された進捗と前提関係を照合した確認候補です。ゲーム内条件の確定判定ではありません。</p>
    <label className="prerequisite-review-filter"><input type="checkbox" checked={onlyCandidates} disabled={review.status !== "ready" && !onlyCandidates}
      onChange={event => onOnlyCandidates(event.target.checked)} />候補のある後続だけを表示</label>
    {review.status !== "ready" ? <p role="status">{review.status === "error" ? "確認候補を確認できません。再読み込みしてください。" : "進捗と前提関係を再確認しています。"}
      {review.status === "error" && onReload && <button type="button" className="button secondary" onClick={onReload}>確認候補を再読み込み</button>}</p> : <>
      <p role="status">プロフィール全体 {candidates.length}件／現在の一覧条件 {matchingCount}件</p>
      {candidates.length === 0 ? <p>現在の対象条件に当てはまる確認候補はありません。</p> : <ol className="prerequisite-review-list" start={page * 20 + 1}>
        {candidates.slice(page * 20, (page + 1) * 20).map(({ successor, prerequisite }) => <li key={`${successor.id}:${prerequisite.id}`}>
          後続「<strong>{successor.title}</strong>」（GVDB ID: {successor.gvdbId}）は達成済み、直接の前提「<strong>{prerequisite.title}</strong>」（GVDB ID: {prerequisite.gvdbId}）は未達成として記録されています。{prerequisite.title}の達成記録をご確認ください。
          <span className="prerequisite-review-reason">確認理由：単一の直接前提に達成記録がありません。</span>
          {completion && <button type="button" className="button secondary prerequisite-review-start" disabled={completion.pending || !!confirmation}
            onClick={event => { originRef.current = event.currentTarget; completion.begin({ successor, prerequisite, successorCompleted: true, prerequisiteCompleted: false, reason: "single_direct_prerequisite_unrecorded" }); }}>
            前提「{prerequisite.title}」を達成済みにする…
          </button>}
        </li>)}
      </ol>}
      {pageCount > 1 && <div className="prerequisite-review-pages" aria-label="確認候補の詳細ページ操作">
        <button type="button" className="button secondary" disabled={page === 0} onClick={() => setPage(current => current - 1)}>候補の前ページ</button>
        <span>{page + 1} / {pageCount}ページ</span>
        <button type="button" className="button secondary" disabled={page + 1 >= pageCount} onClick={() => setPage(current => current + 1)}>候補の次ページ</button>
      </div>}
    </>}
  </>}</section>;
}
