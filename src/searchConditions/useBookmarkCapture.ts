import { useLayoutEffect } from "react";
import type { SearchConditionApplicationProps } from "./application";
import { captureSearchCondition, type SearchTableState } from "./tableState";

export function useBookmarkCapture(
  publish: SearchConditionApplicationProps["onBookmarkCapture"],
  scope: Parameters<typeof captureSearchCondition>[0],
  { columnFilters, sorting }: SearchTableState,
  available: boolean,
) {
  useLayoutEffect(() => {
    if (!publish || !available) return;
    publish(captureSearchCondition(scope, { columnFilters, sorting }));
    return () => publish(undefined);
  }, [publish, scope, columnFilters, sorting, available]);
}
