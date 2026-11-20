import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import type { SearchConditionDefinition } from "../searchConditions/definition";
import type { SearchTableState } from "../searchConditions/tableState";

export type WorkspaceTabId = number;
export type WorkspacePage = SearchConditionDefinition["page"];
export type WorkspaceTabPlacement = "before" | "after";
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

interface SearchTabInfo {
  id: WorkspaceTabId;
  page: WorkspacePage;
  name: string;
}

interface OverviewTabInfo {
  id: WorkspaceTabId;
  page: "overview";
  name: "概要";
}

interface SearchTab extends SearchTabInfo {
  view: SearchTableView;
}

export type WorkspaceTabInfo = SearchTabInfo | OverviewTabInfo;
type WorkspaceTab = SearchTab | OverviewTabInfo;

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
    if (!this.hasSearchCapacity()) return undefined;
    const id = this.nextId++;
    this.tabs.set(id, { id, page, name, view: createSearchTableView() });
    if (!staged) this.publishTab(id);
    return id;
  }

  openOverview(): WorkspaceTabId {
    const existing = this.overviewId();
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.tabs.set(id, { id, page: "overview", name: "概要" });
    this.publishTab(id);
    return id;
  }

  publishTab(id: WorkspaceTabId) {
    const tab = this.tabs.get(id);
    if (!tab || this.openTabs.some(item => item.id === id)) return;
    this.openTabs = [...this.openTabs, this.tabInfo(tab)];
    this.notify();
  }

  discardStaged(id: WorkspaceTabId) {
    if (!this.openTabs.some(tab => tab.id === id) && this.tabs.delete(id)) this.notify();
  }

  move = (id: WorkspaceTabId, targetId: WorkspaceTabId, placement: WorkspaceTabPlacement) => {
    const from = this.openTabs.findIndex(tab => tab.id === id);
    const target = this.openTabs.findIndex(tab => tab.id === targetId);
    if (from < 0 || target < 0 || from === target) return undefined;
    const to = target + (placement === "after" ? 1 : 0) - (from < target ? 1 : 0);
    if (to === from) return undefined;

    const ordered = [...this.openTabs];
    const [tab] = ordered.splice(from, 1);
    ordered.splice(to, 0, tab!);
    this.openTabs = ordered;
    this.notify();
    return { position: to + 1, total: ordered.length };
  };

  rename(id: WorkspaceTabId, name: string) {
    const normalized = name.trim();
    const tab = this.tabs.get(id);
    if (!tab || tab.page === "overview" || !normalized || tab.name === normalized) return;
    this.tabs.set(id, { ...tab, name: normalized });
    this.openTabs = this.openTabs.map(item => item.id === id && item.page !== "overview" ? { ...item, name: normalized } : item);
    this.notify();
  }

  get(id: WorkspaceTabId): Readonly<WorkspaceTab> | undefined {
    return this.tabs.get(id);
  }

  getSearchView(id: WorkspaceTabId): SearchTableView | undefined {
    const tab = this.tabs.get(id);
    return tab?.page === "overview" ? undefined : tab?.view;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  updateView(id: WorkspaceTabId, update: Parameters<UpdateSearchTableView>[0]) {
    const tab = this.tabs.get(id);
    if (!tab || tab.page === "overview") return;
    const view = update(tab.view);
    if (view === tab.view) return;
    this.tabs.set(id, { ...tab, view });
    this.notify();
  }

  resetPagination() {
    for (const id of this.tabs.keys()) this.updateView(id, firstPage);
    if (this.closed && this.closed.tab.page !== "overview") {
      this.closed.tab = { ...this.closed.tab, view: firstPage(this.closed.tab.view) };
    }
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
    if (!this.closed) return undefined;
    const { tab, index } = this.closed;
    if (tab.page !== "overview" && !this.hasSearchCapacity()) return undefined;
    const existing = tab.page === "overview" ? this.overviewId() : undefined;
    this.closed = undefined;
    if (existing !== undefined) {
      this.notify();
      return existing;
    }
    const id = this.nextId++;
    const restored = { ...tab, id };
    this.tabs.set(id, restored);
    this.openTabs = [...this.openTabs.slice(0, index), this.tabInfo(restored), ...this.openTabs.slice(index)];
    this.notify();
    return id;
  }

  private overviewId() {
    return this.openTabs.find(tab => tab.page === "overview")?.id;
  }

  private hasSearchCapacity() {
    return this.tabs.size - (this.overviewId() === undefined ? 0 : 1) < MAX_WORKSPACE_TABS;
  }

  private tabInfo(tab: WorkspaceTab): WorkspaceTabInfo {
    return tab.page === "overview" ? tab : { id: tab.id, page: tab.page, name: tab.name };
  }

  private notify() {
    this.listeners.forEach(notify => notify());
  }
}

export interface WorkspaceTabBinding {
  tabs: WorkspaceTabs;
  id: WorkspaceTabId;
}
