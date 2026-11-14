import type { ReactNode } from "react";
import { COMPACT_WORKSPACE_QUERY, useResponsiveDisclosure } from "./useResponsiveDisclosure";

interface WorkspaceFiltersProps {
  search: ReactNode;
  searchActive: boolean;
  activeFilterCount: number;
  sorted: boolean;
  label: string;
  children: ReactNode;
}

export function WorkspaceFilters({ search, searchActive, activeFilterCount, sorted, label, children }: WorkspaceFiltersProps) {
  const disclosure = useResponsiveDisclosure(COMPACT_WORKSPACE_QUERY);
  const conditions = [
    searchActive ? "検索中" : null,
    activeFilterCount > 0 ? `絞り込み${activeFilterCount}件` : "絞り込みなし",
    sorted ? "並べ替えあり" : null,
  ].filter(Boolean).join("・");

  return <div className="workspace-filters">
    <div className="workspace-search">
      {search}
      <button type="button" className="button secondary" ref={disclosure.buttonRef}
        aria-expanded={disclosure.expanded} aria-controls={disclosure.id} onClick={disclosure.toggle}>
        詳細フィルター{disclosure.expanded ? "を閉じる" : "を開く"}
      </button>
      <span className="filter-conditions" role="group" aria-label="適用中の条件">{conditions}</span>
    </div>
    <div id={disclosure.id} ref={disclosure.panelRef} hidden={!disclosure.expanded}
      className="workspace-filter-panel" role="region" aria-label={label}>
      {children}
    </div>
  </div>;
}
