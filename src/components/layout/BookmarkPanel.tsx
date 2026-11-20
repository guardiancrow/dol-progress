import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SearchBookmarkError, type SearchBookmark } from "../../repositories/searchBookmarkRepository";
import { searchConditionIssueMessage } from "../../searchConditions/SearchConditionFeedback";
import type { ConditionResult, SearchConditionDefinition } from "../../searchConditions/definition";
import type { BookmarkLibrary, BookmarkRepository } from "../../searchConditions/useBookmarkLibrary";

type Page = SearchBookmark["page"];
type Edit = { kind: "create" } | { kind: "rename" | "update" | "delete"; bookmark: SearchBookmark };
const pageNames: Record<Page, string> = { quests: "クエスト", discoveries: "発見物" };
const unavailable = "一覧の検索条件を取得できる状態で保存してください。";

function errorText(error: unknown): string {
  if (error instanceof SearchBookmarkError) {
    switch (error.kind) {
      case "invalid_name": return "有効なブックマーク名を入力してください。";
      case "duplicate_name": return "このページには同じ名前のブックマークがあります。";
      case "bookmark_limit": return "ブックマークの上限は両ページ合計50件です。";
      case "favorite_limit": return "お気に入りの上限は両ページ合計5件です。";
      case "wrong_page": return "同じページの検索条件で更新してください。";
      case "invalid_condition": return "この検索条件は保存できません。";
    }
  }
  return "ブックマークを変更できませんでした。";
}

function summary({ definition }: SearchBookmark): string {
  if (definition.status === "blocked") return searchConditionIssueMessage(definition.issue);
  const condition = definition.value;
  const selected = condition.page === "quests" ? condition.filters.offerCity : condition.filters.category;
  const mainFilter = selected?.kind === "named" ? selected.name : "";
  const count = Object.keys(condition.filters).length - Number(Boolean(mainFilter));
  return [condition.search.trim() ? `検索「${condition.search.trim()}」` : "", mainFilter, count ? `絞り込み ${count}件` : "",
    condition.sorting.length ? "並べ替えあり" : ""].filter(Boolean).join("・") || "一覧の初期条件";
}

interface BookmarkPanelProps {
  page: Page;
  tabId: number;
  captured?: ConditionResult<SearchConditionDefinition>;
  library: BookmarkLibrary;
  apply(bookmark: SearchBookmark, inNewTab?: boolean): void;
}

export function BookmarkPanel({ page, tabId, captured, library, apply }: BookmarkPanelProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Page | "all">(page);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<Edit>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const editorInput = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const editorOrigin = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const writePending = useRef(false);
  const displayedTab = useRef(tabId);
  const panel = useRef<HTMLElement>(null);
  const condition = captured?.status === "ready" && captured.value.page === page ? captured.value : undefined;

  useLayoutEffect(() => {
    if (displayedTab.current === tabId) return;
    displayedTab.current = tabId;
    if (open) {
      editorOrigin.current = null;
      composing.current = false;
      setEdit(undefined);
      setOpen(false);
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    }
  }, [tabId, open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (edit) (editorInput.current ?? confirmButton.current)?.focus({ preventScroll: true });
    else if (editorOrigin.current) {
      const origin = editorOrigin.current;
      editorOrigin.current = null;
      if (origin.isConnected && !origin.closest("[hidden], details:not([open])") && (!(origin instanceof HTMLButtonElement) || !origin.disabled)) origin.focus({ preventScroll: true });
      else searchInput.current?.focus({ preventScroll: true });
    } else {
      searchInput.current?.focus({ preventScroll: true });
    }
  }, [open, edit]);

  function close() {
    editorOrigin.current = null;
    composing.current = false;
    setEdit(undefined);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function openPanel() {
    setNotice(undefined);
    setTarget(page);
    setQuery("");
    setOpen(true);
    void library.refresh();
  }

  function start(next: Edit, origin: HTMLElement) {
    setNotice(undefined);
    editorOrigin.current = origin;
    setName(next.kind === "rename" ? next.bookmark.name : "");
    setEdit(next);
  }

  async function perform(action: (repo: BookmarkRepository) => Promise<unknown>, success: string, finish = false) {
    if (writePending.current) return;
    writePending.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      await library.mutate(action);
      setNotice({ text: success, error: false });
      if (finish) setEdit(undefined);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      writePending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!edit || composing.current || writePending.current) return;
    switch (edit.kind) {
      case "create":
        if (condition) void perform(repo => repo.create(name, condition), "ブックマークを保存しました。", true);
        break;
      case "rename":
        void perform(repo => repo.rename(edit.bookmark.id, name), "ブックマーク名を変更しました。", true);
        break;
      case "update":
        if (condition && edit.bookmark.page === page) void perform(repo => repo.updateCondition(edit.bookmark.id, condition), "ブックマークの条件を更新しました。", true);
        break;
      case "delete":
        void perform(repo => repo.delete(edit.bookmark.id), "ブックマークを削除しました。", true);
    }
  }

  function panelKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  const rows = library.rows;
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const visible = rows?.filter(row => (target === "all" || row.page === target) && row.name.toLocaleLowerCase("ja").includes(normalizedQuery));
  const favoriteCount = rows?.filter(row => row.isFavorite).length;
  const editingName = edit?.kind === "create" || edit?.kind === "rename";

  return <div className="bookmark-toolbar">
    <button ref={trigger} className="button secondary" type="button" aria-controls={panelId} aria-expanded={open} onClick={open ? close : openPanel}>ブックマーク</button>
    {notice && <span className="bookmark-notice" role={notice.error ? "alert" : "status"}>{notice.text}</span>}
    <section id={panelId} ref={panel} hidden={!open} aria-label="ブックマーク管理" className="bookmark-panel" onKeyDown={panelKey}>
      {open && <>
        <div className="bookmark-controls">
          <label>対象ページ<select value={target} onChange={event => setTarget(event.target.value as Page | "all")}>
            <option value="all">すべて</option><option value="quests">クエスト</option><option value="discoveries">発見物</option>
          </select></label>
          <label>ブックマーク名を検索<input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <button className="button secondary" type="button" disabled={busy || !!edit || !condition || !rows}
            onClick={event => start({ kind: "create" }, event.currentTarget)}>現在の条件を保存</button>
        </div>
        {rows && <p className="bookmark-count">保存済み {rows.length} / 50件・お気に入り {favoriteCount} / 5件</p>}
        {rows?.length === 50 && <p className="bookmark-count">新規保存は、既存のブックマークを削除してから行えます。</p>}
        {!condition && <p className="bookmark-count">{captured?.status === "blocked" ? searchConditionIssueMessage(captured.issue) : unavailable}</p>}
        {edit && <form className="bookmark-editor" onSubmit={submit} onKeyDown={event => {
          if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
        }}>
          {edit.kind === "rename" && <p>「{edit.bookmark.name}」の名前を変更します。</p>}
          {editingName && <label>ブックマーク名<input ref={editorInput} value={name} onChange={event => setName(event.target.value)}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} disabled={busy} /></label>}
          {edit.kind === "update" && <p>「{edit.bookmark.name}」を現在の条件で上書きしますか？</p>}
          {edit.kind === "delete" && <p>「{edit.bookmark.name}」を削除しますか？</p>}
          <div className="bookmark-actions">
            <button className="button secondary" type="button" disabled={busy} onClick={() => { composing.current = false; setEdit(undefined); }}>キャンセル</button>
            <button className={`button${edit.kind === "delete" ? " danger" : ""}`} ref={confirmButton} type="submit"
              disabled={busy || ((edit.kind === "update" || edit.kind === "create") && !condition)}>
              {edit.kind === "delete" ? "削除する" : edit.kind === "update" ? "更新する" : "保存する"}
            </button>
          </div>
        </form>}
        {library.readFailed ? <div className="bookmark-actions"><span role="alert">ブックマークを読み込めませんでした。</span>
          <button type="button" className="button secondary" onClick={() => void library.refresh()}>再読み込み</button></div>
          : !visible ? <p role="status">ブックマークを読み込んでいます…</p>
          : visible.length === 0 ? <p>{rows?.length ? "一致するブックマークがありません。" : "保存済みのブックマークがありません。"}</p>
          : <ul aria-label="保存済みブックマーク" className="bookmark-list">
            {visible.map(bookmark => <li key={bookmark.id} className="bookmark-row">
              <div className="bookmark-row-main">
                <button className="bookmark-name" type="button" disabled={busy} onClick={() => { setNotice(undefined); apply(bookmark); }}>{bookmark.name}</button>
                <span className="bookmark-summary">{pageNames[bookmark.page]}・{summary(bookmark)}</span>
              </div>
              <button type="button" className="button secondary" disabled={busy || !!edit} aria-pressed={bookmark.isFavorite}
                aria-label={`${bookmark.name}のお気に入り`} onClick={() => void perform(repo => repo.setFavorite(bookmark.id, !bookmark.isFavorite),
                  bookmark.isFavorite ? "お気に入りを解除しました。" : "お気に入りに登録しました。")}>{bookmark.isFavorite ? "★" : "☆"}</button>
              <details className="bookmark-row-menu">
                <summary aria-label={`${bookmark.name}の操作`}>操作</summary>
                <div className="bookmark-actions">
                  <button type="button" className="button secondary" disabled={busy || !!edit}
                    onClick={() => { setNotice(undefined); apply(bookmark, true); }}>新しいタブで開く</button>
                  <button type="button" className="button secondary" disabled={busy || !!edit} onClick={event => start({ kind: "rename", bookmark }, event.currentTarget)}>名前を変更</button>
                  {bookmark.page === page && <button type="button" className="button secondary" disabled={busy || !!edit || !condition}
                    onClick={event => start({ kind: "update", bookmark }, event.currentTarget)}>現在の条件で更新</button>}
                  <button type="button" className="button secondary" disabled={busy || !!edit} onClick={event => start({ kind: "delete", bookmark }, event.currentTarget)}>削除</button>
                </div>
              </details>
            </li>)}
          </ul>}
      </>}
    </section>
  </div>;
}
