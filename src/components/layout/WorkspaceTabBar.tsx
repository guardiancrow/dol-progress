import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { workspacePageNames, type WorkspacePage, type WorkspaceTabId, type WorkspaceTabInfo } from "../../workspaceTabs/state";

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
}

export function WorkspaceTabBar({ tabs, activeId, closedName, focusRequest, onCreate, onSelect, onRename, onClose, onRestore }: WorkspaceTabBarProps) {
  const [rovingId, setRovingId] = useState(activeId);
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<{ id: WorkspaceTabId; name: string; empty: boolean }>();
  const tabList = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const createId = useId();
  const nameErrorId = useId();
  const editingId = editor?.id;
  const lastRevealedSelection = useRef<WorkspaceTabId | undefined>(undefined);

  function focusTab(id: WorkspaceTabId) {
    setRovingId(id);
    const element = document.getElementById(workspaceTabId(id));
    if (element && document.activeElement === element) revealTab(tabList.current, element.parentElement);
    else element?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    setRovingId(activeId);
    setCreating(false);
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
    if (creating) firstChoice.current?.focus();
  }, [creating]);

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
    } else if (key === "F2") {
      event.preventDefault();
      startRename(tab);
    }
  }

  function closeCreate() {
    setCreating(false);
    plus.current?.focus();
  }

  return <div className="workspace-tabs">
    <div className="workspace-tabs-line">
      <div className="workspace-tab-list" ref={tabList} role="tablist" aria-label="一覧タブ"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRovingId(activeId); }}>
        {tabs.map((tab, index) => <div className="workspace-tab" role="presentation" key={tab.id} data-selected={tab.id === activeId}
          onFocus={event => revealTab(tabList.current, event.currentTarget)}>
          <button className="workspace-tab-label" type="button" role="tab" id={workspaceTabId(tab.id)}
            aria-selected={tab.id === activeId} aria-controls={workspacePanelId(tab.id)} title={`${tab.name}（${workspacePageNames[tab.page]}）`}
            tabIndex={tab.id === rovingId ? 0 : -1} onFocus={() => setRovingId(tab.id)}
            onClick={() => onSelect(tab.id)} onKeyDown={event => tabKey(event, tab, index)}>{tab.name}</button>
          <button className="workspace-tab-close" type="button" aria-label={`${tab.name}を閉じる`}
            title={`${tab.name}を閉じる`} tabIndex={tab.id === rovingId ? 0 : -1} onClick={() => onClose(tab.id)}>×</button>
        </div>)}
      </div>
      <div className="workspace-tab-actions" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setCreating(false); }}>
        <button className="button secondary" type="button" aria-label="新しいタブ" title="新しいタブ" ref={plus}
          aria-expanded={creating} aria-controls={createId} onClick={() => creating ? closeCreate() : setCreating(true)}>＋</button>
        <div className="workspace-tab-create" id={createId} hidden={!creating}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeCreate(); } }}>
          <button className="button secondary" ref={firstChoice} type="button" onClick={() => { closeCreate(); onCreate("quests"); }}>クエストを開く</button>
          <button className="button secondary" type="button" onClick={() => { closeCreate(); onCreate("discoveries"); }}>発見物を開く</button>
        </div>
        <button className="button secondary" type="button" aria-label="タブ名を変更" title="タブ名を変更 (F2)"
          onClick={() => { const tab = tabs.find(item => item.id === activeId); if (tab) startRename(tab); }}>改名</button>
        {closedName !== undefined && <button className="button secondary" type="button" title={`「${closedName}」を復元`}
          onClick={onRestore}>元に戻す</button>}
      </div>
    </div>
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
