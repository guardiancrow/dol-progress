import type { ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import type { SearchConditionDefinition } from "../searchConditions/definition";
import type { SearchTableState } from "../searchConditions/tableState";

export type WorkspaceTabId = number;
export type WorkspacePage = SearchConditionDefinition["page"];

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

interface WorkspaceTab {
  id: WorkspaceTabId;
  page: WorkspacePage;
  name: string;
  view: SearchTableView;
}

// Owned by one App instance. IDs are never reused, so a delayed update cannot address a replacement tab.
export class WorkspaceTabs {
  private nextId = 1;
  private readonly tabs = new Map<WorkspaceTabId, WorkspaceTab>();
  private readonly listeners = new Set<() => void>();

  open(page: WorkspacePage, name: string): WorkspaceTabId {
    const id = this.nextId++;
    this.tabs.set(id, { id, page, name, view: createSearchTableView() });
    return id;
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
    this.listeners.forEach(notify => notify());
  }

  resetPagination() {
    for (const id of this.tabs.keys()) this.updateView(id, firstPage);
  }

  close(id: WorkspaceTabId) {
    if (this.tabs.delete(id)) this.listeners.forEach(notify => notify());
  }
}

export interface WorkspaceTabBinding {
  tabs: WorkspaceTabs;
  id: WorkspaceTabId;
}
