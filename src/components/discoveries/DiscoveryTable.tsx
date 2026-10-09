import { useEffect, useMemo, useState } from "react";
import {
  columnFilteringFeature,
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

import type { DiscoveryRowViewModel } from "../../discoveries/types";
import { MasterInfoButton, MasterInfoProvider } from "../MasterInfoPopover";

const featureSet = tableFeatures({
  columnFilteringFeature,
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
  rows: DiscoveryRowViewModel[];
  paginationResetKey: number;
  initialCategoryId?: number;
  onCategoryNavigationConsumed?(): void;
  onToggleDiscovered(discoveryId: number, discovered: boolean): Promise<void>;
  onSetReported(discoveryId: number, reported: boolean): Promise<void>;
  onSetCardOwned(discoveryId: number, cardOwned: boolean): Promise<void>;
}

export function DiscoveryTable({
  rows,
  paginationResetKey,
  initialCategoryId,
  onCategoryNavigationConsumed,
  onToggleDiscovered,
  onSetReported,
  onSetCardOwned,
}: DiscoveryTableProps) {
  // Navigation initializes this mount only; consuming the intent must not reset later user filters.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    initialCategoryId !== undefined && rows.some((row) => row.category?.id === initialCategoryId)
      ? [{ id: "category", value: initialCategoryId }]
      : [],
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

  useEffect(() => {
    if (initialCategoryId !== undefined) onCategoryNavigationConsumed?.();
  }, [initialCategoryId, onCategoryNavigationConsumed]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("status", {
          id: "status",
          header: "発見状態",
          filterFn: (row, _columnId, value) => {
            if (value === undefined) return true;
            if (value === "undiscovered") return row.original.progress === null;
            if (value === "unreported") return row.original.canReport && row.original.progress !== null && !row.original.progress.reported;
            return row.original.canReport && row.original.progress?.reported === true;
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
              <span className="quest-title">{getValue<string>()}</span>
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
          cell: ({ row }) => row.original.relatedQuests.length === 0 ? "—" : <span className="quest-long-text">{row.original.relatedQuests.map((quest) => quest.title).join("、")}</span>,
        }),
        columnHelper.accessor((row) => row.progress?.reported ?? null, {
          id: "reported",
          header: "報告状態",
          enableSorting: false,
          cell: ({ row }) => row.original.canReport ? (
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
      state: { columnFilters, sorting, pagination },
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
  const unreportedCount = filteredRows.filter((row) => row.original.canReport && row.original.progress !== null && !row.original.progress.reported).length;
  const cardOwnedCount = filteredRows.filter((row) => row.original.hasCard && row.original.progress?.cardOwned).length;
  const pageCount = table.getPageCount();

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
      items={table.getRowModel().rows.map(({ original }) => ({
        id: original.id, title: original.name, description: original.description, notes: original.notes,
      }))}
      resetKey={JSON.stringify([paginationResetKey, columnFilters, sorting, pagination])}
      hint="説明・備考を表示"
    >
    <div className="workspace-table">
      <div className="quest-filters discovery-filters">
        <label>発見物名を検索<input type="search" value={String(table.getColumn("name")?.getFilterValue() ?? "")} onChange={(event) => setFilter("name", event.target.value || undefined)} /></label>
        <label>分類<select value={String(table.getColumn("category")?.getFilterValue() ?? "all")} onChange={(event) => setFilter("category", event.target.value === "all" ? undefined : event.target.value === "unset" ? "unset" : Number(event.target.value))}><option value="all">すべて</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}{hasUncategorized && <option value="unset">未設定</option>}</select></label>
        <label>状態<select value={String(table.getColumn("status")?.getFilterValue() ?? "all")} onChange={(event) => setFilter("status", event.target.value === "all" ? undefined : event.target.value)}><option value="all">すべて</option><option value="undiscovered">未発見</option><option value="unreported">発見済み・未報告</option><option value="reported">報告済み</option></select></label>
        <label>カード所有<select value={cardOwnedFilterValue(table.getColumn("cardOwned")?.getFilterValue())} onChange={(event) => setFilter("cardOwned", event.target.value === "all" ? undefined : event.target.value === "owned")}><option value="all">すべて</option><option value="owned">所有</option><option value="not-owned">非所有（発見済みのみ）</option></select></label>
      </div>
      <div className="quest-summary" aria-live="polite"><span>{rows.length.toLocaleString("ja-JP")}件中 {filteredRows.length.toLocaleString("ja-JP")}件表示</span><span>発見済み {discoveredCount.toLocaleString("ja-JP")}件</span><span>未報告 {unreportedCount.toLocaleString("ja-JP")}件</span><span>カード所有 {cardOwnedCount.toLocaleString("ja-JP")}件</span></div>
      {filteredRows.length === 0 ? <div className="state-panel empty-state"><h3>条件に一致する発見物がありません</h3><p>検索条件または絞り込み条件を変更してください。</p></div> : (
        <div className="quest-table-scroll discovery-table-scroll"><table className="quest-table discovery-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => { const canSort = header.column.getCanSort(); const direction = header.column.getIsSorted(); return <th key={header.id} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}>{header.isPlaceholder ? null : canSort ? <button type="button" className="sort-button" aria-label={`${String(header.column.columnDef.header)}で並べ替え`} onClick={header.column.getToggleSortingHandler()}><table.FlexRender header={header} /><span aria-hidden="true">{direction === "asc" ? " ▲" : direction === "desc" ? " ▼" : " ↕"}</span></button> : <table.FlexRender header={header} />}</th>; })}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>)}</tbody></table></div>
      )}
      <div className="pagination" aria-label="発見物一覧ページ操作"><button type="button" className="button secondary" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>前ページ</button><span>{pageCount === 0 ? 0 : table.state.pagination.pageIndex + 1} / {pageCount}ページ</span><button type="button" className="button secondary" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>次ページ</button><label>1ページの件数<select value={table.state.pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}><option value={50}>50件</option><option value={100}>100件</option></select></label></div>
    </div>
    </MasterInfoProvider>
  );
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
