import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ColumnFiltersState, PaginationState, SortingState, Updater } from "@tanstack/react-table";
import {
  createSearchTableView, firstPage, type SearchTableView, type UpdateSearchTableView, type WorkspaceTabBinding,
} from "../workspaceTabs/state";

export interface SearchTableController {
  view: SearchTableView;
  updateView: UpdateSearchTableView;
}

const subscribeLocally = () => () => {};

export function useSearchTableState(binding?: WorkspaceTabBinding): SearchTableController {
  const { tabs, id } = binding ?? {};
  const [local, setLocal] = useState(createSearchTableView);
  const getView = useCallback(() => id === undefined ? undefined : tabs?.get(id)?.view, [tabs, id]);
  const tabView = useSyncExternalStore(tabs?.subscribe ?? subscribeLocally, getView);
  const updateView = useCallback<UpdateSearchTableView>(update => {
    if (tabs && id !== undefined) tabs.updateView(id, update);
    else setLocal(update);
  }, [tabs, id]);
  return { view: tabView ?? local, updateView };
}

function applyUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export function useSearchTableControls(paginationResetKey: number, controlled?: SearchTableController) {
  const [localView, updateLocalView] = useState(createSearchTableView);
  const { view, updateView } = controlled ?? { view: localView, updateView: updateLocalView };
  const previousResetKey = useRef(paginationResetKey);

  useEffect(() => {
    if (previousResetKey.current === paginationResetKey) return;
    previousResetKey.current = paginationResetKey;
    updateView(firstPage);
  }, [paginationResetKey, updateView]);

  const setColumnFilters = useCallback((updater: Updater<ColumnFiltersState>) => updateView(current => {
    const columnFilters = applyUpdater(updater, current.columnFilters);
    return columnFilters === current.columnFilters ? current : { ...current, columnFilters, appliedDefinition: undefined };
  }), [updateView]);

  const setSorting = useCallback((updater: Updater<SortingState>) => updateView(current => {
    const sorting = applyUpdater(updater, current.sorting);
    return sorting === current.sorting ? current : { ...current, sorting, appliedDefinition: undefined };
  }), [updateView]);

  const setPagination = useCallback((updater: Updater<PaginationState>) => updateView(current => {
    const pagination = applyUpdater(updater, current.pagination);
    return pagination === current.pagination ? current : { ...current, pagination };
  }), [updateView]);

  return { ...view, setColumnFilters, setSorting, setPagination };
}
