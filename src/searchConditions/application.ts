import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { blocked, type ConditionResult, type SearchConditionDefinition } from "./definition";
import type { SearchTableState } from "./tableState";
import type { SearchTableController } from "./useSearchTableState";
import { createSearchTableView, firstPage, type SearchTableView, type WorkspaceTabBinding, type WorkspaceTabId } from "../workspaceTabs/state";

export interface SearchConditionRequest {
  definition: SearchConditionDefinition;
  profileId: number;
  tabId: WorkspaceTabId;
  // An overview link refers to a category in this master, independently of saved names.
  discoveryDrilldown?: { categoryId?: number };
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

export function useCanFollowSearchRetry(profileId: number | null, {
  staged, searchConditionRequest: request, workspaceTab, masterRevision,
}: SearchConditionApplicationProps) {
  const tabs = workspaceTab?.tabs;
  const id = workspaceTab?.id;
  const current = useRef<{ revision: number; isOpen(): boolean } | undefined>(undefined);
  useLayoutEffect(() => {
    if (staged && request && request.profileId === profileId && request.tabId === id && tabs) {
      current.current = { revision: masterRevision ?? 0, isOpen: () => tabs.get(request.tabId) !== undefined };
    }
    return () => { current.current = undefined; };
  }, [staged, request, profileId, id, tabs, masterRevision]);
  return useCallback((revision?: number) => {
    const scope = current.current;
    return scope !== undefined && (revision === undefined || revision === scope.revision) && scope.isOpen();
  }, []);
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
  resolve: (condition: SearchConditionDefinition, drilldown?: SearchConditionRequest["discoveryDrilldown"]) => Resolution,
  { view, updateView }: SearchTableController,
) {
  const [resetKey, setResetKey] = useState(0);
  const current = staged ? undefined : view.appliedDefinition;
  const pending = searchConditionRequest?.profileId === profileId && searchConditionRequest.tabId === workspaceTab?.id
    ? searchConditionRequest : undefined;
  const ready = useMemo(() => current ? resolve(current) : undefined, [current, resolve]);
  const attempted = useMemo(() => pending ? resolve(pending.definition, pending.discoveryDrilldown) : undefined, [pending, resolve]);

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
