import { useLayoutEffect, useMemo, useState } from "react";
import { blocked, type ConditionResult, type SearchConditionDefinition, type SearchConditionIssue } from "./definition";
import type { SearchTableState } from "./tableState";

export interface SearchConditionRequest {
  definition: SearchConditionDefinition;
  profileId: number;
}

export interface SearchConditionApplicationProps {
  searchConditionRequest?: SearchConditionRequest;
  onSearchConditionSettled?: (request: SearchConditionRequest, issue?: SearchConditionIssue) => void;
  masterRevision?: number;
  masterImporting?: boolean;
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

export interface AppliedSearchCondition {
  request: SearchConditionRequest;
  state: SearchTableState;
}

export function useSearchConditionApplication(
  profileId: number | null,
  { searchConditionRequest, onSearchConditionSettled }: SearchConditionApplicationProps,
  resolve: (condition: SearchConditionDefinition) => Resolution,
) {
  const [active, setActive] = useState<SearchConditionRequest>();
  const [resetKey, setResetKey] = useState(0);
  const current = active?.profileId === profileId ? active : undefined;
  const pending = searchConditionRequest?.profileId === profileId ? searchConditionRequest : undefined;
  const ready = useMemo(() => current ? resolve(current.definition) : undefined, [current, resolve]);
  const attempted = useMemo(() => pending ? resolve(pending.definition) : undefined, [pending, resolve]);
  const applied = useMemo<AppliedSearchCondition | undefined>(() => current && ready?.status === "ready"
    ? { request: current, state: ready.value } : undefined, [current, ready]);

  useLayoutEffect(() => {
    if (active && active.profileId !== profileId) setActive(undefined);
  }, [active, profileId]);

  useLayoutEffect(() => {
    if (!pending || !attempted || attempted.status === "waiting") return;
    if (attempted.status === "ready") setActive(pending);
    onSearchConditionSettled?.(pending, attempted.status === "blocked" ? attempted.issue : undefined);
  }, [pending, attempted, onSearchConditionSettled]);

  return {
    applied,
    suspended: current !== undefined && ready?.status !== "ready",
    waiting: attempted?.status === "waiting" || ready?.status === "waiting",
    issue: ready?.status === "blocked" ? ready.issue : undefined,
    resetKey,
    forgetApplied: () => setActive(undefined),
    clearUnavailable: () => {
      setActive(undefined);
      setResetKey(key => key + 1);
    },
  };
}

export type SearchConditionApplication = ReturnType<typeof useSearchConditionApplication>;
