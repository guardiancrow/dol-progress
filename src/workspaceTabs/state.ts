import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import type { SearchConditionDefinition } from "../searchConditions/definition";
import type { SearchTableState } from "../searchConditions/tableState";

export type WorkspaceTabId = number;
export type WorkspacePage = SearchConditionDefinition["page"];
export const MAX_WORKSPACE_TABS = 6;
export const workspacePageNames: Record<WorkspacePage, string> = { quests: "クエスト", discoveries: "発見物" };

export interface SearchTableView extends SearchTableState {
  pagination: PaginationState;
  // Revalidate the last applied bookmark independently of the editable table state.
  appliedDefinition?: SearchConditionDefinition;
}

export function createSearchTableView(columnFilters: ColumnFiltersState = []): SearchTableView {
  return { columnFilters, sorting: [], pagination: { pageIndex: 0, pageSize: 50 } };
}

export function firstPage(view: SearchTableView): SearchTableView {
  return view.pagination.pageIndex === 0 ? view : { ...view, pagination: { ...view.pagination, pageIndex: 0 } };
}

export type UpdateSearchTableView = (update: (current: SearchTableView) => SearchTableView) => void;

export interface WorkspaceTabInfo {
  id: WorkspaceTabId;
  page: WorkspacePage;
  name: string;
}

interface WorkspaceTab extends WorkspaceTabInfo {
  view: SearchTableView;
}

// Owned by one App instance. IDs are never reused, so a delayed update cannot address a replacement tab.
export class WorkspaceTabs {
  private nextId = 1;
  private readonly tabs = new Map<WorkspaceTabId, WorkspaceTab>();
  private readonly listeners = new Set<() => void>();
  private openTabs: readonly WorkspaceTabInfo[] = [];
  private closed?: { tab: WorkspaceTab; index: number };

  getOpenTabs = () => this.openTabs;

  get closedName() { return this.closed?.tab.name; }

  open(page: WorkspacePage, name = workspacePageNames[page], staged = false): WorkspaceTabId | undefined {
    if (this.tabs.size >= MAX_WORKSPACE_TABS) return undefined;
    const id = this.nextId++;
    this.tabs.set(id, { id, page, name, view: createSearchTableView() });
    if (!staged) this.publishTab(id);
    return id;
  }

  publishTab(id: WorkspaceTabId) {
    const tab = this.tabs.get(id);
    if (!tab || this.openTabs.some(item => item.id === id)) return;
    const { page, name } = tab;
    this.openTabs = [...this.openTabs, { id, page, name }];
    this.notify();
  }

  discardStaged(id: WorkspaceTabId) {
    if (!this.openTabs.some(tab => tab.id === id) && this.tabs.delete(id)) this.notify();
  }

  rename(id: WorkspaceTabId, name: string) {
    const normalized = name.trim();
    const tab = this.tabs.get(id);
    if (!tab || !normalized || tab.name === normalized) return;
    this.tabs.set(id, { ...tab, name: normalized });
    this.openTabs = this.openTabs.map(item => item.id === id ? { ...item, name: normalized } : item);
    this.notify();
  }

  get(id: WorkspaceTabId): Readonly<WorkspaceTab> | undefined {
    return this.tabs.get(id);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  updateView(id: WorkspaceTabId, update: Parameters<UpdateSearchTableView>[0]) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const view = update(tab.view);
    if (view === tab.view) return;
    this.tabs.set(id, { ...tab, view });
    this.notify();
  }

  resetPagination() {
    for (const id of this.tabs.keys()) this.updateView(id, firstPage);
    if (this.closed) this.closed.tab = { ...this.closed.tab, view: firstPage(this.closed.tab.view) };
  }

  close(id: WorkspaceTabId) {
    const index = this.openTabs.findIndex(tab => tab.id === id);
    const tab = this.tabs.get(id);
    if (index < 0 || !tab) return undefined;
    this.closed = { tab, index };
    this.tabs.delete(id);
    this.openTabs = this.openTabs.filter(item => item.id !== id);
    this.notify();
    return this.openTabs[index]?.id ?? this.openTabs[index - 1]?.id;
  }

  restore(): WorkspaceTabId | undefined {
    if (!this.closed || this.tabs.size >= MAX_WORKSPACE_TABS) return undefined;
    const { tab, index } = this.closed;
    const id = this.nextId++;
    this.tabs.set(id, { ...tab, id });
    this.openTabs = [...this.openTabs.slice(0, index), { id, page: tab.page, name: tab.name }, ...this.openTabs.slice(index)];
    this.closed = undefined;
    this.notify();
    return id;
  }

  private notify() {
    this.listeners.forEach(notify => notify());
  }
}

export interface WorkspaceTabBinding {
  tabs: WorkspaceTabs;
  id: WorkspaceTabId;
}
