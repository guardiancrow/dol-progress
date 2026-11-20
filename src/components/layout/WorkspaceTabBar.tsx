import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { workspacePageNames, type WorkspacePage, type WorkspaceTabId, type WorkspaceTabInfo, type WorkspaceTabPlacement } from "../../workspaceTabs/state";
import { useWorkspaceTabDrag } from "./useWorkspaceTabDrag";

export const workspaceTabId = (id: WorkspaceTabId) => `workspace-tab-${id}`;
export const workspacePanelId = (id: WorkspaceTabId) => `workspace-panel-${id}`;
export type WorkspaceFocus = { tabId: WorkspaceTabId } | { undo: true };

function revealTab(list: HTMLDivElement | null, tab: HTMLElement | null) {
  if (!list?.clientWidth || !tab) return;
  const left = list.getBoundingClientRect().left + list.clientLeft;
  const right = left + list.clientWidth;
  const bounds = tab.getBoundingClientRect();
  if (bounds.left < left) list.scrollLeft += bounds.left - left;
  else if (bounds.right > right) list.scrollLeft += bounds.right - right;
}

interface WorkspaceTabBarProps {
  tabs: readonly WorkspaceTabInfo[];
  activeId: WorkspaceTabId;
  closedName?: string;
  focusRequest?: WorkspaceFocus;
  onCreate(page: WorkspacePage): void;
  onSelect(id: WorkspaceTabId): void;
  onRename(id: WorkspaceTabId, name: string): void;
  onClose(id: WorkspaceTabId): void;
  onRestore(): void;
  onMove(id: WorkspaceTabId, targetId: WorkspaceTabId, placement: WorkspaceTabPlacement): { position: number; total: number } | undefined;
}

export function WorkspaceTabBar({ tabs, activeId, closedName, focusRequest, onCreate, onSelect, onRename, onClose, onRestore, onMove }: WorkspaceTabBarProps) {
  const [rovingId, setRovingId] = useState(activeId);
  const [creating, setCreating] = useState(false);
  const [moveMenu, setMoveMenu] = useState<{ id: WorkspaceTabId; fromTab: boolean }>();
  const [completedMove, setCompletedMove] = useState<{ id: WorkspaceTabId; message: string }>();
  const [editor, setEditor] = useState<{ id: WorkspaceTabId; name: string; empty: boolean }>();
  const tabList = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const moveTrigger = useRef<HTMLButtonElement>(null);
  const moveLeft = useRef<HTMLButtonElement>(null);
  const moveRight = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const createId = useId();
  const moveId = useId();
  const nameErrorId = useId();
  const editingId = editor?.id;
  const renamableTab = tabs.find(tab => tab.id === activeId && tab.page !== "overview");
  const lastRevealedSelection = useRef<WorkspaceTabId | undefined>(undefined);
  const moveIndex = tabs.findIndex(tab => tab.id === moveMenu?.id);
  const drag = useWorkspaceTabDrag(tabList, moveTab);

  function focusTab(id: WorkspaceTabId) {
    setRovingId(id);
    const element = document.getElementById(workspaceTabId(id));
    if (element && document.activeElement === element) revealTab(tabList.current, element.parentElement);
    else element?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    setRovingId(activeId);
    setCreating(false);
    setMoveMenu(undefined);
    setEditor(undefined);
    composing.current = false;
  }, [activeId]);

  useLayoutEffect(() => {
    const list = tabList.current;
    if (!list) return;
    const selected = document.getElementById(workspaceTabId(activeId))?.parentElement ?? null;
    const revealVisibleTab = () => {
      const focused = document.activeElement?.closest<HTMLElement>(".workspace-tab");
      revealTab(list, focused && list.contains(focused) ? focused : selected);
    };
    if (lastRevealedSelection.current === activeId) revealVisibleTab();
    else revealTab(list, selected);
    lastRevealedSelection.current = activeId;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealVisibleTab);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeId, tabs]);

  useLayoutEffect(() => {
    if (focusRequest && "tabId" in focusRequest) focusTab(focusRequest.tabId);
  }, [focusRequest]);

  useLayoutEffect(() => {
    if (completedMove) focusTab(completedMove.id);
  }, [completedMove]);

  useLayoutEffect(() => {
    if (creating) firstChoice.current?.focus();
  }, [creating]);

  useLayoutEffect(() => {
    if (moveMenu) (moveIndex === 0 ? moveRight : moveLeft).current?.focus();
  }, [moveMenu]);

  useLayoutEffect(() => {
    if (editingId === undefined) return;
    editInput.current?.focus();
    editInput.current?.select();
  }, [editingId]);

  useLayoutEffect(() => {
    if (editingId !== undefined && !tabs.some(tab => tab.id === editingId)) {
      setEditor(undefined);
      composing.current = false;
    }
  }, [editingId, tabs]);

  function startRename(tab: WorkspaceTabInfo) {
    setCreating(false);
    setMoveMenu(undefined);
    composing.current = false;
    setEditor({ id: tab.id, name: tab.name, empty: false });
  }

  function endRename(id: WorkspaceTabId) {
    composing.current = false;
    setEditor(undefined);
    focusTab(id);
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    if (!editor || composing.current) return;
    const name = editor.name.trim();
    if (!name) {
      setEditor({ ...editor, empty: true });
      editInput.current?.focus();
      return;
    }
    onRename(editor.id, name);
    endRename(editor.id);
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceTabInfo, index: number) {
    const key = event.key;
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End") {
      event.preventDefault();
      const next = key === "Home" ? 0 : key === "End" ? tabs.length - 1
        : (index + (key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      focusTab(tabs[next]!.id);
    } else if (key === "Delete") {
      event.preventDefault();
      onClose(tab.id);
    } else if (key === "F2" && tab.page !== "overview") {
      event.preventDefault();
      startRename(tab);
    } else if (key === "F10" && event.shiftKey && tabs.length > 1) {
      event.preventDefault();
      openMoveMenu(tab.id, true);
    }
  }

  function moveTab(id: WorkspaceTabId, targetId: WorkspaceTabId, placement: WorkspaceTabPlacement) {
    const tab = tabs.find(item => item.id === id);
    if (!tab) return;
    const result = onMove(id, targetId, placement);
    if (!result) return;
    setCompletedMove({ id, message: `「${tab.name}」を${result.total}件中${result.position}番目に移動しました。` });
  }

  function openMoveMenu(id: WorkspaceTabId, fromTab: boolean) {
    setCreating(false);
    setMoveMenu({ id, fromTab });
  }

  function closeMoveMenu() {
    setMoveMenu(undefined);
    if (moveMenu?.fromTab) focusTab(moveMenu.id);
    else moveTrigger.current?.focus({ preventScroll: true });
  }

  function moveBy(offset: -1 | 1) {
    const target = tabs[moveIndex + offset];
    if (moveIndex < 0 || !moveMenu || !target) return;
    setMoveMenu(undefined);
    moveTab(moveMenu.id, target.id, offset === -1 ? "before" : "after");
  }

  function closeCreate() {
    setCreating(false);
    plus.current?.focus();
  }

  return <div className="workspace-tabs">
    <div className="workspace-tabs-line">
      <div className="workspace-tab-list" ref={tabList} role="tablist" aria-label="一覧タブ"
        onPointerDownCapture={drag.clearDragClick} onClickCapture={drag.preventDragClick}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRovingId(activeId); }}>
        {tabs.map((tab, index) => <div className="workspace-tab" role="presentation" key={tab.id} data-selected={tab.id === activeId}
          data-workspace-tab-id={tab.id} data-dragging={drag.preview?.id === tab.id || undefined}
          onFocus={event => revealTab(tabList.current, event.currentTarget)}>
          <button className="workspace-tab-label" type="button" role="tab" id={workspaceTabId(tab.id)}
            aria-selected={tab.id === activeId} aria-controls={workspacePanelId(tab.id)} title={tab.page === "overview" ? tab.name : `${tab.name}（${workspacePageNames[tab.page]}）`}
            tabIndex={tab.id === rovingId ? 0 : -1} onFocus={() => setRovingId(tab.id)}
            draggable={false} onPointerDown={event => drag.startDrag(event, tab.id)}
            onClick={() => onSelect(tab.id)} onKeyDown={event => tabKey(event, tab, index)}>{tab.name}</button>
          <button className="workspace-tab-close" type="button" aria-label={`${tab.name}を閉じる`}
            title={`${tab.name}を閉じる`} tabIndex={tab.id === rovingId ? 0 : -1} onClick={() => onClose(tab.id)}>×</button>
        </div>)}
      </div>
      {drag.preview?.marker !== undefined && <span className="workspace-tab-insertion" style={{ left: drag.preview.marker }} aria-hidden="true" />}
      <div className="workspace-tab-actions" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setCreating(false);
          setMoveMenu(undefined);
        }
      }}>
        <button className="button secondary" type="button" aria-label="新しいタブ" title="新しいタブ" ref={plus}
          aria-expanded={creating} aria-controls={createId} onClick={() => {
            if (creating) closeCreate();
            else { setMoveMenu(undefined); setCreating(true); }
          }}>＋</button>
        <div className="workspace-tab-menu" id={createId} hidden={!creating}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeCreate(); } }}>
          <button className="button secondary" ref={firstChoice} type="button" onClick={() => { closeCreate(); onCreate("quests"); }}>クエストを開く</button>
          <button className="button secondary" type="button" onClick={() => { closeCreate(); onCreate("discoveries"); }}>発見物を開く</button>
        </div>
        <button className="button secondary" type="button" aria-label="タブを並べ替え" title="タブを並べ替え (Shift+F10)" ref={moveTrigger}
          disabled={tabs.length < 2} aria-expanded={moveMenu !== undefined} aria-controls={moveId}
          onClick={() => moveMenu ? closeMoveMenu() : openMoveMenu(activeId, false)}>↔</button>
        <div className="workspace-tab-menu" id={moveId} hidden={moveIndex < 0} role="group" aria-label={`${tabs[moveIndex]?.name ?? "タブ"}の並べ替え`}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeMoveMenu(); } }}>
          <button className="button secondary" ref={moveLeft} type="button" disabled={moveIndex <= 0} onClick={() => moveBy(-1)}>左へ移動</button>
          <button className="button secondary" ref={moveRight} type="button" disabled={moveIndex >= tabs.length - 1} onClick={() => moveBy(1)}>右へ移動</button>
        </div>
        {renamableTab &&
          <button className="button secondary" type="button" aria-label="タブ名を変更" title="タブ名を変更 (F2)"
            onClick={() => startRename(renamableTab)}>改名</button>}
        {closedName !== undefined && <button className="button secondary" type="button" title={`「${closedName}」を復元`}
          onClick={onRestore}>元に戻す</button>}
      </div>
    </div>
    <span className="workspace-tab-announcement" aria-live="polite" aria-atomic="true">
      {completedMove && <span key={completedMove.id}>{completedMove.message}</span>}
    </span>
    {editor && <form className="workspace-tab-editor" onSubmit={rename} onKeyDown={event => {
      const inComposition = composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
      if (event.key === "Enter" && inComposition) event.preventDefault();
      if (event.key === "Escape" && !inComposition) { event.preventDefault(); endRename(editor.id); }
    }}>
      <label>タブ名<input ref={editInput} value={editor.name} aria-invalid={editor.empty}
        aria-describedby={editor.empty ? nameErrorId : undefined}
        onChange={event => setEditor({ ...editor, name: event.target.value, empty: false })}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /></label>
      <button className="button secondary" type="submit">保存</button>
      <button className="button secondary" type="button" onClick={() => endRename(editor.id)}>キャンセル</button>
      {editor.empty && <span id={nameErrorId} role="alert">タブ名を入力してください。</span>}
    </form>}
  </div>;
}
