import type { ReactNode } from "react";
import { COMPACT_WORKSPACE_QUERY, useResponsiveDisclosure } from "./useResponsiveDisclosure";
import { DisclosureIcon } from "./DisclosureIcon";

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
      <button type="button" className="button secondary filter-toggle" ref={disclosure.buttonRef}
        aria-label={disclosure.expanded ? "詳細フィルターを閉じる" : "詳細フィルターを開く"}
        title={disclosure.expanded ? "詳細フィルターを閉じる" : "詳細フィルターを開く"}
        aria-expanded={disclosure.expanded} aria-controls={disclosure.id} onClick={disclosure.toggle}>
        <DisclosureIcon kind="filters" />
        <span>絞り込み</span>
        <DisclosureIcon kind="chevron" expanded={disclosure.expanded} />
      </button>
      <span className="filter-conditions" role="group" aria-label="適用中の条件">{conditions}</span>
    </div>
    <div id={disclosure.id} ref={disclosure.panelRef} hidden={!disclosure.expanded}
      className="workspace-filter-panel" role="region" aria-label={label}>
      {children}
    </div>
  </div>;
}
