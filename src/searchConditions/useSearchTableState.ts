import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ColumnFiltersState, PaginationState, SortingState, Updater } from "@tanstack/react-table";
import type { AppliedSearchCondition } from "./application";
import type { SearchTableState } from "./tableState";

function update<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function sameTableState(left: SearchTableState, right: SearchTableState): boolean {
  return left.columnFilters.length === right.columnFilters.length && left.sorting.length === right.sorting.length
    && left.columnFilters.every((filter, index) => filter.id === right.columnFilters[index]?.id && filter.value === right.columnFilters[index]?.value)
    && left.sorting.every((sort, index) => sort.id === right.sorting[index]?.id && sort.desc === right.sorting[index]?.desc);
}

export function useSearchTableState(initialFilters: () => ColumnFiltersState, applied?: AppliedSearchCondition) {
  const [view, setView] = useState(() => ({
    columnFilters: applied?.state.columnFilters ?? initialFilters(),
    sorting: applied?.state.sorting ?? [],
    pagination: { pageIndex: 0, pageSize: 50 },
  }));
  const previous = useRef(applied);

  useLayoutEffect(() => {
    if (!applied || applied === previous.current) return;
    const sameRequest = previous.current?.request === applied.request;
    previous.current = applied;
    setView(current => sameRequest && sameTableState(current, applied.state) ? current : {
      ...applied.state,
      pagination: { ...current.pagination, pageIndex: 0 },
    });
  }, [applied]);

  const setColumnFilters = useCallback((updater: Updater<ColumnFiltersState>) => setView(current => {
    const columnFilters = update(updater, current.columnFilters);
    return columnFilters === current.columnFilters ? current : { ...current, columnFilters };
  }), []);
  const setSorting = useCallback((updater: Updater<SortingState>) => setView(current => {
    const sorting = update(updater, current.sorting);
    return sorting === current.sorting ? current : { ...current, sorting };
  }), []);
  const setPagination = useCallback((updater: Updater<PaginationState>) => setView(current => {
    const pagination = update(updater, current.pagination);
    return pagination === current.pagination ? current : { ...current, pagination };
  }), []);
  return { ...view, setColumnFilters, setSorting, setPagination };
}
