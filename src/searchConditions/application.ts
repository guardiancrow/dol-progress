import { useLayoutEffect, useMemo, useState } from "react";
import { blocked, type ConditionResult, type SearchConditionDefinition } from "./definition";
import type { SearchTableState } from "./tableState";
import type { SearchTableController } from "./useSearchTableState";
import { createSearchTableView, firstPage, type SearchTableView, type WorkspaceTabBinding, type WorkspaceTabId } from "../workspaceTabs/state";

export interface SearchConditionRequest {
  definition: SearchConditionDefinition;
  profileId: number;
  tabId: WorkspaceTabId;
}

export interface SearchConditionApplicationProps {
  workspaceTab?: WorkspaceTabBinding;
  staged?: boolean;
  searchConditionRequest?: SearchConditionRequest;
  onSearchConditionSettled?: (request: SearchConditionRequest, result: ConditionResult<SearchTableState>) => void;
  masterRevision?: number;
  masterImporting?: boolean;
  onBookmarkCapture?: (condition: ConditionResult<SearchConditionDefinition> | undefined) => void;
}

export type ReadState = "loading" | "ready" | "error";
type Resolution = ConditionResult<SearchTableState> | { status: "waiting" };

export function whenSearchDataReady(
  requirements: readonly (readonly [field: string, state: ReadState])[],
  resolve: () => ConditionResult<SearchTableState>,
): Resolution {
  const failed = requirements.find(([, state]) => state === "error");
  if (failed) return blocked("read-failed", failed[0]);
  if (requirements.some(([, state]) => state === "loading")) return { status: "waiting" };
  return resolve();
}

export function applySearchCondition(view: SearchTableView, definition: SearchConditionDefinition, state: SearchTableState): SearchTableView {
  return firstPage({ ...view, ...state, appliedDefinition: definition });
}

function sameTableState(left: SearchTableState, right: SearchTableState): boolean {
  return left.columnFilters.length === right.columnFilters.length && left.sorting.length === right.sorting.length
    && left.columnFilters.every((filter, index) => filter.id === right.columnFilters[index]?.id && filter.value === right.columnFilters[index]?.value)
    && left.sorting.every((sort, index) => sort.id === right.sorting[index]?.id && sort.desc === right.sorting[index]?.desc);
}

export function useSearchConditionApplication(
  profileId: number | null,
  { workspaceTab, staged, searchConditionRequest, onSearchConditionSettled }: SearchConditionApplicationProps,
  resolve: (condition: SearchConditionDefinition) => Resolution,
  { view, updateView }: SearchTableController,
) {
  const [resetKey, setResetKey] = useState(0);
  const current = staged ? undefined : view.appliedDefinition;
  const pending = searchConditionRequest?.profileId === profileId && searchConditionRequest.tabId === workspaceTab?.id
    ? searchConditionRequest : undefined;
  const ready = useMemo(() => current ? resolve(current) : undefined, [current, resolve]);
  const attempted = useMemo(() => pending ? resolve(pending.definition) : undefined, [pending, resolve]);

  useLayoutEffect(() => {
    if (!current || ready?.status !== "ready") return;
    updateView(view => view.appliedDefinition !== current || sameTableState(view, ready.value)
      ? view : applySearchCondition(view, current, ready.value));
  }, [current, ready, updateView]);

  useLayoutEffect(() => {
    if (!pending || !attempted || attempted.status === "waiting") return;
    onSearchConditionSettled?.(pending, attempted);
  }, [pending, attempted, onSearchConditionSettled]);

  return {
    suspended: current !== undefined && ready?.status !== "ready",
    waiting: attempted?.status === "waiting" || ready?.status === "waiting",
    issue: ready?.status === "blocked" ? ready.issue : undefined,
    resetKey,
    clearUnavailable: () => {
      updateView(() => createSearchTableView());
      setResetKey(key => key + 1);
    },
  };
}

export type SearchConditionApplication = ReturnType<typeof useSearchConditionApplication>;
