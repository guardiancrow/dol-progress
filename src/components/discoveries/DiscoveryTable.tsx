import { WorkspaceFilters } from "../layout/WorkspaceFilters";
import { useWorkspaceView } from "../layout/WorkspaceView";
import { mapDiscoveryStatus, mapDiscoveryLabels, mapDiscoveryReviewReason } from "../../discoveries/mapReacquisition";
import { currentUnreportedHistory } from "../../discoveries/unreportedBreakdown";
import { FirstReportControl } from "./FirstReportControl";
import { DiscoveryStateControl } from "./ReportHoldControls";
import type { ReportHoldController } from "../../discoveries/useReportHold";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";

import type { DiscoveryInitialFilter, DiscoveryRowViewModel } from "../../discoveries/types";
import { MasterInfoButton, MasterInfoProvider } from "../MasterInfoPopover";
import { formatOfferCities } from "../../domain/offerCities";

const featureSet = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columnHelper = createColumnHelper<typeof featureSet, DiscoveryRowViewModel>();
const collator = new Intl.Collator("ja", { numeric: true });
const STATUS_ORDER = { undiscovered: 0, unreported: 1, reported: 2 } as const;
type CardOwnedFilter = "all" | "owned" | "not-owned";

interface DiscoveryTableProps {
  historyReadState?: "loading" | "ready" | "error";
  reportHold?: ReportHoldController;
  rows: DiscoveryRowViewModel[];
  paginationResetKey: number;
  initialFilter?: DiscoveryInitialFilter;
  onNavigationConsumed?(): void;
  onToggleDiscovered(discoveryId: number, discovered: boolean): Promise<void>;
  onSetReported(discoveryId: number, reported: boolean): Promise<void>;
  onSetCardOwned(discoveryId: number, cardOwned: boolean): Promise<void>;
}

export function DiscoveryTable({
  historyReadState = "ready",
  rows,
  paginationResetKey,
  initialFilter,
  onNavigationConsumed,
  reportHold,
  onToggleDiscovered,
  onSetReported,
  onSetCardOwned,
}: DiscoveryTableProps) {
  const controlsVisible = useWorkspaceView()?.controlsVisible ?? true;
  const reportHoldRef = useRef(reportHold);
  reportHoldRef.current = reportHold;
  // Navigation initializes this mount only; consuming the intent must not reset later user filters.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    if (initialFilter?.kind === "category" && rows.some((row) => row.category?.id === initialFilter.categoryId)) {
      return [{ id: "category", value: initialFilter.categoryId }];
    }
    if (initialFilter?.kind === "unreported") return [{ id: "status", value: "unreported" }];
    if (initialFilter?.kind === "card-not-owned") return [{ id: "cardOwned", value: false }];
    return [];
  });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  useEffect(() => {
    if (initialFilter !== undefined) onNavigationConsumed?.();
  }, [initialFilter, onNavigationConsumed]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor(currentUnreportedHistory, { id: "unreportedBreakdown", header: "未報告の内訳", enableSorting: false,
          filterFn: (row, id, value) => row.getValue(id) === value, cell: () => null }),
        columnHelper.accessor(row => mapDiscoveryStatus(row), {id:"mapReacquisition",header:"地図",enableSorting:false,
          filterFn:(row,id,value)=>!value || value === "all" || (value === "related" ? row.getValue<string>(id) !== "unrelated" : row.getValue<string>(id) === value),cell:()=>null}),
        columnHelper.accessor("status", {
          id: "status",
          header: "発見状態",
          filterFn: (row, _columnId, value) => {
            if (value === undefined) return true;
            if (value === "undiscovered") return row.original.progress === null;
            if (value === "unreported") return row.original.canReport && row.original.progress !== null && !row.original.effectiveReported;
            return row.original.canReport && row.original.effectiveReported;
          },
          sortFn: (a, b, id) =>
            STATUS_ORDER[a.getValue<DiscoveryRowViewModel["status"]>(id)] -
            STATUS_ORDER[b.getValue<DiscoveryRowViewModel["status"]>(id)],
          cell: ({ row }) => (
            <label className="table-check">
              <input
                type="checkbox"
                aria-label={`${row.original.name}の発見状態`}
                checked={row.original.progress !== null}
                disabled={row.original.updating}
                onChange={() => void onToggleDiscovered(row.original.id, row.original.progress !== null)}
              />
              <span>{statusLabel(row.original.status)}</span>
            </label>
          ),
        }),
        columnHelper.accessor("name", {
          id: "name",
          header: "発見物名",
          filterFn: (row, id, value) => row.getValue<string>(id).includes(String(value).trim()),
          sortFn: (a, b, id) => collator.compare(a.getValue(id), b.getValue(id)),
          cell: ({ row, getValue }) => (
            <span className="master-info-name">
              <span className="discovery-name-content"><span className="quest-title" title={getValue<string>()}>{getValue<string>()}</span><MapBadge row={row.original} /></span>
              <MasterInfoButton rowId={row.original.id} />
            </span>
          ),
        }),
        columnHelper.accessor((row) => row.category?.name ?? null, {
          id: "category",
          header: "分類",
          filterFn: (row, _id, value) => value === "unset" ? row.original.category === null : row.original.category?.id === value,
          sortFn: (a, b) => {
            const left = a.original.category;
            const right = b.original.category;
            if (left === null) return right === null ? 0 : 1;
            if (right === null) return -1;
            return left.sortOrder - right.sortOrder || collator.compare(left.name, right.name);
          },
          cell: ({ row }) => row.original.category?.name ?? "未設定",
        }),
        numericColumn("rank", "ランク"),
        columnHelper.accessor("era", {
          id: "era",
          header: "時代",
          sortUndefined: "last",
          sortFn: nullableTextSort,
          cell: ({ getValue }) => getValue<string | null>() ?? "—",
        }),
        numericColumn("points", "ポイント"),
        numericColumn("difficulty", "難易度"),
        numericColumn("experience", "経験"),
        columnHelper.accessor((row) => row.relatedQuests.map((quest) => quest.title).join("、"), {
          id: "relatedQuests",
          header: "関連クエスト",
          enableSorting: false,
          cell: ({ row }) => row.original.relatedQuests.length === 0 ? "—" : (
            <div className="quest-long-text">{row.original.relatedQuests.map((quest) => (
              <span className="master-info-name" key={quest.id}>
                <span className="quest-title">{quest.title}</span>
                <MasterInfoButton rowId={`quest:${row.original.id}:${quest.id}`} />
              </span>
            ))}</div>
          ),
        }),
        columnHelper.accessor((row) => row.progress === null ? null : row.effectiveReported, {
          id: "reported",
          header: "報告状態",
          enableSorting: false,
          cell: ({ row }) => row.original.mapRelated && reportHoldRef.current
            ? <DiscoveryStateControl id={row.original.id} name={row.original.name} controller={reportHoldRef.current} disabled={row.original.updating} discoveryMapMode />
            : row.original.canReport ? row.original.automaticReporting ? <span>{row.original.progress === null ? "—" : "報告済み（自動）"}</span> : (
            <label className="table-check">
              <input
                type="checkbox"
                aria-label={`${row.original.name}の報告状態`}
                checked={row.original.progress?.reported ?? false}
                disabled={row.original.progress === null || row.original.updating}
                onChange={() => void onSetReported(row.original.id, !(row.original.progress?.reported ?? false))}
              />
              <span>{row.original.progress === null ? "—" : row.original.progress.reported ? "報告済み" : "未報告"}</span>
            </label>
          ) : <span>対象外</span>,
        }),
        columnHelper.display({id:"firstReport",header:"初回報告",enableSorting:false,
          cell:({row})=><FirstReportControl row={row.original} controller={reportHoldRef.current} /> }),
        columnHelper.accessor((row) => row.hasCard ? row.progress?.cardOwned ?? null : null, {
          id: "cardOwned",
          header: "カード所有",
          filterFn: (row, _id, value) => row.original.hasCard && row.original.progress !== null && row.original.progress.cardOwned === value,
          sortFn: (a, b) => nullableBooleanSort(a.original.hasCard ? a.original.progress?.cardOwned ?? null : null, b.original.hasCard ? b.original.progress?.cardOwned ?? null : null),
          sortDescFirst: false,
          cell: ({ row }) => row.original.hasCard ? (
            <label className="table-check">
              <input
                type="checkbox"
                aria-label={`${row.original.name}のカード所有状態`}
                checked={row.original.progress?.cardOwned ?? false}
                disabled={row.original.progress === null || row.original.updating}
                onChange={() => void onSetCardOwned(row.original.id, !(row.original.progress?.cardOwned ?? false))}
              />
              <span>{row.original.progress === null ? "—" : row.original.progress.cardOwned ? "所有" : "なし"}</span>
            </label>
          ) : <span>対象外</span>,
        }),
      ]),
    [onSetCardOwned, onSetReported, onToggleDiscovered],
  );

  const table = useTable(
    {
      features: featureSet,
      columns,
      data: rows,
      state: { columnFilters, sorting, pagination, columnVisibility: {mapReacquisition:false, unreportedBreakdown:false} },
      onColumnFiltersChange: setColumnFilters,
      onSortingChange: (updater) => {
        setSorting(updater);
        setPagination((current) => ({ ...current, pageIndex: 0 }));
      },
      onPaginationChange: setPagination,
      autoResetPageIndex: false,
      getRowId: (row) => String(row.id),
    },
    (state) => ({ columnFilters: state.columnFilters, sorting: state.sorting, pagination: state.pagination }),
  );

  const categories = useMemo(() => {
    const unique = new Map<number, { id: number; name: string; sortOrder: number }>();
    for (const row of rows) if (row.category) unique.set(row.category.id, row.category);
    return [...unique.values()].sort((a, b) => a.sortOrder - b.sortOrder || collator.compare(a.name, b.name));
  }, [rows]);
  const hasUncategorized = rows.some((row) => row.category === null);
  const filteredRows = table.getPrePaginatedRowModel().rows;
  const discoveredCount = filteredRows.filter((row) => row.original.progress !== null).length;
  const unreportedCount = filteredRows.filter((row) => row.original.canReport && row.original.progress !== null && !row.original.effectiveReported).length;
  const cardOwnedCount = filteredRows.filter((row) => row.original.hasCard && row.original.progress?.cardOwned).length;
  const pageCount = table.getPageCount();
  const breakdownUnavailable = table.getColumn("unreportedBreakdown")?.getFilterValue() !== undefined && historyReadState !== "ready";

  useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0
        ? current
        : { ...current, pageIndex: 0 },
    );
  }, [paginationResetKey]);

  useEffect(() => {
    const lastValidPage = pageCount === 0 ? 0 : pageCount - 1;
    setPagination((current) =>
      current.pageIndex > lastValidPage
        ? { ...current, pageIndex: lastValidPage }
        : current,
    );
  }, [pageCount]);

  function setFilter(id: string, value: unknown) {
    table.getColumn(id)?.setFilterValue(value);
    table.setPageIndex(0);
  }

  return (
    <MasterInfoProvider
      items={table.getRowModel().rows.flatMap(({ original }) => [
        { id: original.id, title: original.name, description: original.description, notes: original.notes },
        ...original.relatedQuests.map((quest) => {
          const cities = formatOfferCities(quest.offerCity === null ? [] : [quest.offerCity]);
          return {
            id: `quest:${original.id}:${quest.id}`, title: quest.title, notes: quest.notes,
            hint: cities
              ? quest.notes?.trim() ? "オファー都市・備考を表示" : "オファー都市を表示"
              : "備考を表示",
            details: cities ? [{ label: "オファー都市", value: cities }] : [],
          };
        }),
      ])}
      resetKey={JSON.stringify([paginationResetKey, columnFilters, sorting, pagination])}
      hint="説明・備考を表示"
    >
    <div className="workspace-table">
      <WorkspaceFilters label="発見物の詳細フィルター" searchActive={String(table.getColumn("name")?.getFilterValue() ?? "").trim() !== ""}
        activeFilterCount={columnFilters.filter(filter => filter.id !== "name").length} sorted={sorting.length > 0}
        search={<label>発見物名を検索<input type="search" value={String(table.getColumn("name")?.getFilterValue() ?? "")} onChange={(event) => setFilter("name", event.target.value || undefined)} /></label>}>
        <div className="quest-filters discovery-filters">
        <label>分類<select value={String(table.getColumn("category")?.getFilterValue() ?? "all")} onChange={(event) => setFilter("category", event.target.value === "all" ? undefined : event.target.value === "unset" ? "unset" : Number(event.target.value))}><option value="all">すべて</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}{hasUncategorized && <option value="unset">未設定</option>}</select></label>
        <label>状態<select value={String(table.getColumn("status")?.getFilterValue() ?? "all")} onChange={(event) => setFilter("status", event.target.value === "all" ? undefined : event.target.value)}><option value="all">すべて</option><option value="undiscovered">未発見</option><option value="unreported">発見済み・未報告</option><option value="reported">報告済み</option></select></label>
        <label title="発見済み・未報告の発見物を初回報告履歴で絞り込みます。地図以外も対象です。">未報告の内訳<select value={String(table.getColumn("unreportedBreakdown")?.getFilterValue() ?? "all")} onChange={event => setFilter("unreportedBreakdown", event.target.value === "all" ? undefined : event.target.value)}><option value="all">すべて</option><option value="not_reported">初回未報告</option><option value="confirmed">再報告待ち</option><option value="unknown">履歴未確定</option></select></label>
        <label>カード所有<select value={cardOwnedFilterValue(table.getColumn("cardOwned")?.getFilterValue())} onChange={(event) => setFilter("cardOwned", event.target.value === "all" ? undefined : event.target.value === "owned")}><option value="all">すべて</option><option value="owned">所有</option><option value="not-owned">未所有（発見済みのみ）</option></select></label>
        <label title="地図のみは、対象の7学問分類に属する有効な地図に関連する発見物です。地図以外は、その関連がない発見物です。すべてのマスター関係で地図と無関係であることを保証するものではありません。判定保留は、一つの地図に複数発見物が関連する場合、または報告対象外の場合です。初回報告履歴の不明とは別の判定です。">地図<select value={String(table.getColumn("mapReacquisition")?.getFilterValue() ?? "all")} onChange={e=>setFilter("mapReacquisition",e.target.value === "all" ? undefined : e.target.value)}><option value="all">すべて</option><option value="related">地図のみ</option><option value="unrelated">地図以外</option><option value="suppressed">地図・未報告（再入手抑止）</option><option value="candidate">地図・再入手候補</option><option value="review">地図・判定保留</option></select></label>
        </div>
      </WorkspaceFilters>
      {breakdownUnavailable ? <div className="state-panel" role="status">{historyReadState === "loading" ? "未報告の内訳を読み込んでいます…" : "未報告の内訳を確認できません。地図・報告履歴を再読み込みしてください。"}</div> : <>
      <div className="quest-summary" aria-live="polite" hidden={!controlsVisible}><span>{rows.length.toLocaleString("ja-JP")}件中 {filteredRows.length.toLocaleString("ja-JP")}件表示</span><span>発見済み {discoveredCount.toLocaleString("ja-JP")}件</span><span>未報告 {unreportedCount.toLocaleString("ja-JP")}件</span><span>カード所有 {cardOwnedCount.toLocaleString("ja-JP")}件</span></div>
      {filteredRows.length === 0 ? <div className="state-panel empty-state"><h3>条件に一致する発見物がありません</h3><p>検索条件または絞り込み条件を変更してください。</p></div> : (
        <div className="quest-table-scroll discovery-table-scroll"><table className="quest-table discovery-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => { const canSort = header.column.getCanSort(); const direction = header.column.getIsSorted(); return <th data-column={header.column.id} title={header.column.id === "firstReport" ? "過去に一度でも報告したかを示します。現在の報告状態とは別の履歴です。レリックと特殊自動報告対象の履歴は訂正できません。" : undefined} key={header.id} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}>{header.isPlaceholder ? null : canSort ? <button type="button" className="sort-button" aria-label={`${String(header.column.columnDef.header)}で並べ替え`} onClick={header.column.getToggleSortingHandler()}><table.FlexRender header={header} /><span aria-hidden="true">{direction === "asc" ? " ▲" : direction === "desc" ? " ▼" : " ↕"}</span></button> : <table.FlexRender header={header} />}</th>; })}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td data-column={cell.column.id} key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody></table></div>
      )}
      <div className="pagination" aria-label="発見物一覧ページ操作"><button type="button" className="button secondary" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>前ページ</button><span>{pageCount === 0 ? 0 : table.state.pagination.pageIndex + 1} / {pageCount}ページ</span><button type="button" className="button secondary" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>次ページ</button><label>1ページの件数<select value={table.state.pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}><option value={50}>50件</option><option value={100}>100件</option></select></label></div>
      </>}
    </div>
    </MasterInfoProvider>
  );
}

function MapBadge({ row }: { row: DiscoveryRowViewModel }) {
  const status = mapDiscoveryStatus(row);
  if (status === "unrelated") return null;
  const reason = mapDiscoveryReviewReason(row);
  if (!reason) return <small className="map-related-badge">{mapDiscoveryLabels[status]}</small>;
  return <span className="map-review-help" tabIndex={0} aria-label={`${mapDiscoveryLabels[status]}：${reason}`}>
    <small className="map-related-badge">{mapDiscoveryLabels[status]}</small>
    <span className="map-review-tooltip" role="tooltip">{reason}</span>
  </span>;
}

function numericColumn(key: "rank" | "points" | "difficulty" | "experience", header: string) {
  return columnHelper.accessor((row) => row[key] ?? undefined, { id: key, header, sortUndefined: "last", sortDescFirst: false, cell: ({ row }) => row.original[key] ?? "—" });
}

function statusLabel(status: DiscoveryRowViewModel["status"]): string {
  if (status === "reported") return "報告済み";
  if (status === "unreported") return "発見済み";
  return "未発見";
}

function nullableTextSort(a: { getValue<T>(id: string): T }, b: { getValue<T>(id: string): T }, id: string): number {
  const left = a.getValue<string | null>(id);
  const right = b.getValue<string | null>(id);
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return collator.compare(left, right);
}

function nullableBooleanSort(left: boolean | null, right: boolean | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return Number(left) - Number(right);
}

function cardOwnedFilterValue(value: unknown): CardOwnedFilter {
  if (value === true) return "owned";
  if (value === false) return "not-owned";
  return "all";
}
