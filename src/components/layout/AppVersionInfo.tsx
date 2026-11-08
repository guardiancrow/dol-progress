import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUpdateCheck, type UpdateState } from "../../updates/useUpdateCheck";
import { openReleasesPage } from "../../updates/openReleasesPage";

export function AppVersionInfo({ version }: { version: string }) {
  const [open, setOpen] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [openingLink, setOpeningLink] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const linkBusy = useRef(false);
  const mounted = useRef(false);
  const id = useId();
  const update = useUpdateCheck(version);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    function reposition() {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const size = panel.current.getBoundingClientRect();
      setPosition({
        left: Math.max(12, Math.min(anchor.right - size.width, window.innerWidth - size.width - 12)),
        top: Math.max(12, anchor.top - size.height - 8),
      });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function openPage() {
    if (linkBusy.current) return;
    linkBusy.current = true;
    setOpeningLink(true);
    setLinkError(false);
    try { await openReleasesPage(); }
    catch { if (mounted.current) setLinkError(true); }
    finally {
      linkBusy.current = false;
      if (mounted.current) setOpeningLink(false);
    }
  }

  return <span className="app-version">
    <button ref={trigger} type="button" className="app-version-trigger" aria-label="アプリケーションのバージョン"
      title={`現在のバージョン v${version}。アプリケーション情報を開きます。`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>v{version}</button>
    {update.updateAvailable && <span className="app-update-available">更新あり</span>}
    {open && createPortal(<div ref={panel} id={id} className="app-version-info" role="dialog" aria-labelledby={`${id}-title`}
      style={position}>
      <div className="app-version-info-heading"><h2 id={`${id}-title`}>アプリケーション情報</h2>
        <button ref={closeButton} type="button" className="button secondary" onClick={() => close(true)}>閉じる</button></div>
      <p>現在のバージョン：v{version}</p>
      <p>GitHubのLatest指定通常版と比較します。全Release中の最大バージョンを保証するものではありません。</p>
      <p>GitHubへ接続します。進捗データは送信しません。IPアドレスなど通常の通信メタデータは送信され得ます。</p>
      <div role="status" aria-live="polite"><p>{resultMessage(update.state)}</p>
        {update.waiting && <p>再確認までしばらくお待ちください。通常は60秒間隔です。利用制限時はさらに待つ必要があります。</p>}</div>
      <button type="button" className="button secondary" disabled={update.state.kind === "checking"}
        onClick={() => void update.start()}>{update.state.kind === "checking" ? "確認中…" : "更新を確認"}</button>
      <button type="button" className="button secondary" disabled={openingLink} onClick={() => void openPage()}>GitHub Releasesを開く</button>
      {update.updateAvailable && <p>配布物の掲載を確認しました。内容の安全性やハッシュの照合を行ったものではありません。更新は手動で行ってください。</p>}
      {linkError && <p role="status">既定ブラウザーを開けませんでした。</p>}
    </div>, document.body)}
  </span>;
}

function resultMessage(state: UpdateState): string {
  if (state.kind === "unchecked") return "未確認";
  if (state.kind === "checking") return "確認中…";
  if (state.kind === "uncomparable") return state.reason === "version" ? "バージョン比較不能：通常版の形式として比較できません。" : "バージョン比較不能：通常の公開Releaseを確認できません。";
  if (state.kind === "failed") {
    if (state.error.code === "timeout") return "通信失敗：更新確認が時間内に完了しませんでした。";
    if (state.error.code === "http") {
      if (state.error.status === 404) return "通信失敗：公開Releaseを確認できません（未公開・非公開など）。";
      if (state.error.status === 403 || state.error.status === 429) return "通信失敗：GitHubの利用制限またはアクセス拒否です。時間をおいて確認してください。";
      return "通信失敗：GitHubから正常な応答がありませんでした。";
    }
    if (state.error.code === "response" || state.error.code === "too-large") return "通信失敗：GitHubの応答を確認できませんでした。";
    return "通信失敗：GitHubへ接続できませんでした。通常の機能は引き続き利用できます。";
  }
  if (state.comparison === "same") return "GitHubのLatest指定通常版と同じ版です。";
  if (state.comparison === "older") return "現在版の方がGitHubのLatest指定通常版より新しいです。";
  if (!state.portableAvailable) return `公開版v${state.version}は現在版より新しいですが、対象配布物（Windows x64 ZIP・SHA-256）が未確認です。`;
  return `新しい公開版v${state.version}があります。`;
}
