import { useEffect, useMemo, useState } from "react";
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

import type { QuestRowViewModel } from "../../quests/types";
import { getRequiredSkillRank } from "../../quests/requiredSkillRank";
import {
  buildOfferMethodOptions,
  isOfferMethodSelectionAvailable,
  matchesOfferMethod,
  offerMethodOptionValue,
} from "../../quests/offerMethods";

const RANK_COLUMN_ID = "selectedRequiredSkillRank";
type CompletionFilter = "all" | "completed" | "incomplete";
type PrerequisiteFilter = "all" | "satisfied" | "unsatisfied" | "unknown" | "none";
const DISCOVERY_CATEGORY_PREFIX = "category:";
const tableFeatureSet = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const columnHelper = createColumnHelper<
  typeof tableFeatureSet,
  QuestRowViewModel
>();
const collator = new Intl.Collator("ja", { numeric: true });

interface QuestTableProps {
  rows: QuestRowViewModel[];
  paginationResetKey: number;
  onToggleCompletion(questId: number, completed: boolean): Promise<void>;
}

export function QuestTable({ rows, paginationResetKey, onToggleCompletion }: QuestTableProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  const selectedSkill = String(columnFilters.find((filter) => filter.id === "requiredSkills")?.value ?? "");
  const hasRank = useMemo(
    () => selectedSkill !== "" && rows.some((row) =>
      getRequiredSkillRank(row.requiredSkillsNormalized, selectedSkill) !== null),
    [rows, selectedSkill],
  );
  const rankSort = sorting.length === 1 && sorting[0]?.id === RANK_COLUMN_ID
    ? sorting[0].desc ? "desc" : "asc"
    : "none";

  useEffect(() => {
    if (!hasRank) {
      setSorting((current) => current.some((item) => item.id === RANK_COLUMN_ID)
        ? current.filter((item) => item.id !== RANK_COLUMN_ID)
        : current);
    }
  }, [hasRank]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("completed", {
          id: "completed",
          header: "達成状態",
          filterFn: (row, columnId, value) =>
            value === undefined || row.getValue<boolean>(columnId) === value,
          sortFn: (rowA, rowB, columnId) =>
            Number(rowA.getValue<boolean>(columnId)) -
            Number(rowB.getValue<boolean>(columnId)),
          cell: ({ row }) => (
            <input
              type="checkbox"
              aria-label={`${row.original.title}の達成状態`}
              checked={row.original.completed}
              disabled={row.original.updating}
              onChange={() =>
                void onToggleCompletion(
                  row.original.id,
                  row.original.completed,
                )
              }
            />
          ),
        }),
        columnHelper.accessor("prerequisiteStatus", {
          id: "prerequisiteStatus",
          header: "前提クエスト",
          enableSorting: false,
          filterFn: (row, columnId, value) => {
            const status = row.getValue<QuestRowViewModel["prerequisiteStatus"]>(columnId);
            switch (value as PrerequisiteFilter) {
              case "satisfied": return status === "NONE" || status === "SATISFIED";
              case "unsatisfied": return status === "UNSATISFIED";
              case "unknown": return status === "UNKNOWN";
              case "none": return status === "NONE";
              default: return true;
            }
          },
          cell: () => null,
        }),
        columnHelper.accessor("title", {
          id: "title",
          header: "クエスト名／地図名",
          filterFn: (row, columnId, value) =>
            row
              .getValue<string>(columnId)
              .includes(String(value).trim()),
          sortFn: (rowA, rowB, columnId) =>
            collator.compare(
              rowA.getValue<string>(columnId),
              rowB.getValue<string>(columnId),
            ),
          cell: ({ getValue }) => (
            <span className="quest-title">{getValue<string>()}</span>
          ),
        }),
        columnHelper.accessor(
          (row) => row.difficulty ?? undefined,
          {
            id: "difficulty",
            header: "難易度",
            sortUndefined: "last",
            cell: ({ row }) => row.original.difficulty ?? "—",
          },
        ),
        columnHelper.accessor("offerMethod", {
          id: "offerMethod",
          header: "オファー方法",
          filterFn: (row, columnId, value) =>
            matchesOfferMethod(row.getValue<string | null>(columnId), value),
          sortFn: nullableTextSort,
          cell: ({ getValue }) => getValue<string | null>() ?? "未設定",
        }),
        columnHelper.accessor("offerCity", {
          id: "offerCity",
          header: "オファー都市",
          filterFn: (row, _columnId, value) =>
            value === undefined || row.original.offerCities.includes(String(value)),
          sortFn: nullableTextSort,
          cell: ({ getValue }) => getValue<string | null>() ?? "未設定",
        }),
        columnHelper.accessor("requiredSkills", {
          id: "requiredSkills",
          header: "必要スキル",
          enableSorting: false,
          filterFn: (row, _columnId, value) =>
            value === undefined || row.original.requiredSkillNames.includes(String(value)),
          cell: ({ getValue }) => (
            <span className="quest-long-text">
              {getValue<string | null>() ?? "—"}
            </span>
          ),
        }),
        columnHelper.accessor(
          (row) => getRequiredSkillRank(row.requiredSkillsNormalized, selectedSkill) ?? undefined,
          {
            id: RANK_COLUMN_ID,
            header: "要求Rank",
            sortUndefined: "last",
            enableMultiSort: false,
            sortFn: (rowA, rowB, columnId) =>
              (rowA.getValue<number | undefined>(columnId) ?? 0) -
              (rowB.getValue<number | undefined>(columnId) ?? 0),
            cell: () => null,
          },
        ),
        columnHelper.accessor(
          (row) => row.discoveries.map((item) => item.name).join("、"),
          {
            id: "discoveries",
            header: "関連発見物",
            enableSorting: false,
            filterFn: (row, _columnId, value) => {
              if (value === "has-any") return row.original.discoveries.length > 0;
              if (value === "has-none") return row.original.discoveries.length === 0;
              if (typeof value === "string" && value.startsWith(DISCOVERY_CATEGORY_PREFIX)) {
                const categoryId = Number(value.slice(DISCOVERY_CATEGORY_PREFIX.length));
                return row.original.discoveries.some((discovery) => discovery.categoryId === categoryId);
              }
              return true;
            },
            cell: ({ row }) =>
              row.original.discoveries.length === 0 ? (
                "—"
              ) : (
                <span className="quest-long-text">
                  {row.original.discoveries
                    .map((discovery) => discovery.name)
                    .join("、")}
                </span>
              ),
          },
        ),
        columnHelper.accessor(
          (row) => row.directPrerequisites.map((item) => item.name).join("、"),
          {
            id: "directPrerequisites",
            header: "前提クエスト",
            enableSorting: false,
            cell: ({ row }) => row.original.directPrerequisites.length === 0 ? null : (
              <span className="quest-prerequisites">
                {row.original.directPrerequisites.map((item) => item.name).join("、")}
              </span>
            ),
          },
        ),
      ]),
    [onToggleCompletion, selectedSkill],
  );

  const table = useTable(
    {
      features: tableFeatureSet,
      columns,
      data: rows,
      state: { columnFilters, sorting, pagination, columnVisibility: {
        prerequisiteStatus: false,
        [RANK_COLUMN_ID]: false,
      } },
      onColumnFiltersChange: setColumnFilters,
      onSortingChange: (updater) => {
        setSorting((current) => {
          const next = typeof updater === "function" ? updater(current) : updater;
          return next.some((item) => item.id !== RANK_COLUMN_ID)
            ? next.filter((item) => item.id !== RANK_COLUMN_ID)
            : next;
        });
        setPagination((current) => ({ ...current, pageIndex: 0 }));
      },
      onPaginationChange: setPagination,
      autoResetPageIndex: false,
      getRowId: (row) => String(row.id),
    },
    (state) => ({
      columnFilters: state.columnFilters,
      sorting: state.sorting,
      pagination: state.pagination,
    }),
  );

  const offerMethodOptions = useMemo(
    () => buildOfferMethodOptions(rows.map((row) => row.offerMethod)),
    [rows],
  );
  const selectedOfferMethod = String(table.getColumn("offerMethod")?.getFilterValue() ?? "all");
  useEffect(() => {
    if (isOfferMethodSelectionAvailable(selectedOfferMethod, offerMethodOptions)) return;
    table.getColumn("offerMethod")?.setFilterValue(undefined);
    table.setPageIndex(0);
  }, [offerMethodOptions, selectedOfferMethod, table]);
  const offerCities = useMemo(
    () => uniqueValues(rows.flatMap((row) => row.offerCities)),
    [rows],
  );
  const requiredSkills = useMemo(
    () => uniqueValues(rows.flatMap((row) => row.requiredSkillNames)),
    [rows],
  );
  const discoveryCategories = useMemo(() => {
    const categories = new Map<number, { id: number; name: string; sortOrder: number }>();
    for (const row of rows) {
      for (const discovery of row.discoveries) {
        if (discovery.categoryId !== null && discovery.categoryName !== null) {
          categories.set(discovery.categoryId, {
            id: discovery.categoryId,
            name: discovery.categoryName,
            sortOrder: discovery.categorySortOrder ?? Number.MAX_SAFE_INTEGER,
          });
        }
      }
    }
    return [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }, [rows]);
  const selectedDiscoveryFilter = String(table.getColumn("discoveries")?.getFilterValue() ?? "all");
  useEffect(() => {
    if (!selectedDiscoveryFilter.startsWith(DISCOVERY_CATEGORY_PREFIX)) return;
    const categoryId = Number(selectedDiscoveryFilter.slice(DISCOVERY_CATEGORY_PREFIX.length));
    if (discoveryCategories.some((category) => category.id === categoryId)) return;
    table.getColumn("discoveries")?.setFilterValue(undefined);
    table.setPageIndex(0);
  }, [discoveryCategories, selectedDiscoveryFilter, table]);
  const filteredRows = table.getPrePaginatedRowModel().rows;
  const filteredCompletedCount = filteredRows.filter(
    (row) => row.original.completed,
  ).length;
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

  function setFilter(columnId: string, value: unknown) {
    table.getColumn(columnId)?.setFilterValue(value);
    table.setPageIndex(0);
  }

  function setRequiredSkill(value: string) {
    setFilter("requiredSkills", value || undefined);
    setSorting((current) => current.some((item) => item.id === RANK_COLUMN_ID)
      ? current.filter((item) => item.id !== RANK_COLUMN_ID)
      : current);
  }

  return (
    <div className="workspace-table">
      <div className="quest-filters">
        <label>
          クエスト名／地図名を検索
          <input
            type="search"
            value={String(table.getColumn("title")?.getFilterValue() ?? "")}
            onChange={(event) =>
              setFilter("title", event.target.value || undefined)
            }
          />
        </label>
        <label>
          達成状態
          <select
            value={completionFilterValue(
              table.getColumn("completed")?.getFilterValue(),
            )}
            onChange={(event) =>
              setFilter(
                "completed",
                event.target.value === "all"
                  ? undefined
                  : event.target.value === "completed",
              )
            }
          >
            <option value="all">すべて</option>
            <option value="incomplete">未達成</option>
            <option value="completed">達成済み</option>
          </select>
        </label>
        <div className="quest-filter-field">
          <div className="quest-filter-label">
            <label htmlFor="prerequisite-filter">前提クエスト</label>
            <details className="quest-filter-help">
              <summary>説明</summary>
              <p>「要確認」は複数前提や地図など、充足を確定できない関係です。</p>
            </details>
          </div>
          <select
            id="prerequisite-filter"
            value={String(table.getColumn("prerequisiteStatus")?.getFilterValue() ?? "all")}
            onChange={(event) => setFilter(
              "prerequisiteStatus",
              event.target.value === "all" ? undefined : event.target.value,
            )}
          >
            <option value="all">すべて</option>
            <option value="satisfied">前提を満たす</option>
            <option value="unsatisfied">前提未達成</option>
            <option value="unknown">要確認</option>
            <option value="none">前提なし</option>
          </select>
        </div>
        <label>
          オファー方法
          <select
            value={selectedOfferMethod}
            onChange={(event) => setFilter(
              "offerMethod",
              event.target.value === "all" ? undefined : event.target.value,
            )}
          >
            <option value="all">すべて</option>
            {(offerMethodOptions.quest.length > 0 || offerMethodOptions.map.length > 0) && (
              <optgroup label="大分類">
                {offerMethodOptions.quest.length > 0 && <option value="group:quest">クエスト</option>}
                {offerMethodOptions.map.length > 0 && <option value="group:map">地図</option>}
              </optgroup>
            )}
            {offerMethodOptions.quest.length > 0 && (
              <optgroup label="クエスト（個別）">
                {offerMethodOptions.quest.map((method) => (
                  <option key={method} value={offerMethodOptionValue(method)}>{method}</option>
                ))}
              </optgroup>
            )}
            {offerMethodOptions.map.length > 0 && (
              <optgroup label="地図（個別）">
                {offerMethodOptions.map.map((method) => (
                  <option key={method} value={offerMethodOptionValue(method)}>{method}</option>
                ))}
              </optgroup>
            )}
            {(offerMethodOptions.other.length > 0 || offerMethodOptions.hasUnset) && (
              <optgroup label="その他">
                {offerMethodOptions.other.map((method) => (
                  <option key={method} value={offerMethodOptionValue(method)}>{method}</option>
                ))}
                {offerMethodOptions.hasUnset && <option value="unset">未設定</option>}
              </optgroup>
            )}
          </select>
        </label>
        <FilterSelect
          label="オファー都市"
          value={String(
            table.getColumn("offerCity")?.getFilterValue() ?? "",
          )}
          options={offerCities}
          onChange={(value) => setFilter("offerCity", value || undefined)}
        />
        <FilterSelect
          label="必要スキル"
          value={String(
            table.getColumn("requiredSkills")?.getFilterValue() ?? "",
          )}
          options={requiredSkills}
          onChange={setRequiredSkill}
        />
        <label>
          要求Rank
          <select
            value={rankSort}
            disabled={!hasRank}
            onChange={(event) => table.setSorting(event.target.value === "none"
              ? []
              : [{ id: RANK_COLUMN_ID, desc: event.target.value === "desc" }])}
          >
            <option value="none">並べ替えなし</option>
            <option value="asc">低い順</option>
            <option value="desc">高い順</option>
          </select>
        </label>
        <label>
          発見物
          <select
            value={selectedDiscoveryFilter}
            onChange={(event) => setFilter(
              "discoveries",
              event.target.value === "all" ? undefined : event.target.value,
            )}
          >
            <option value="all">すべて</option>
            <optgroup label="状態">
              <option value="has-any">発見物あり</option>
              <option value="has-none">発見物なし</option>
            </optgroup>
            {discoveryCategories.length > 0 && (
              <optgroup label="分類">
                {discoveryCategories.map((category) => (
                  <option key={category.id} value={`${DISCOVERY_CATEGORY_PREFIX}${category.id}`}>
                    {category.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      <div className="quest-summary" aria-live="polite">
        <span>{rows.length.toLocaleString("ja-JP")}件中 {filteredRows.length.toLocaleString("ja-JP")}件表示</span>
        <span>達成済み {filteredCompletedCount.toLocaleString("ja-JP")}件</span>
      </div>

      {filteredRows.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>条件に一致するクエストがありません</h3>
          <p>検索条件または絞り込み条件を変更してください。</p>
        </div>
      ) : (
        <div className="quest-table-scroll">
          <table className="quest-table quest-master-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const direction = header.column.getIsSorted();
                    return (
                      <th key={header.id} scope="col" aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : undefined
                      }>
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="sort-button"
                            aria-label={`${String(header.column.columnDef.header)}で並べ替え`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={header} />
                            <span aria-hidden="true">
                              {direction === "asc" ? " ▲" : direction === "desc" ? " ▼" : " ↕"}
                            </span>
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination" aria-label="クエスト一覧ページ操作">
        <button
          type="button"
          className="button secondary"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          前ページ
        </button>
        <span>
          {pageCount === 0 ? 0 : table.state.pagination.pageIndex + 1} / {pageCount}ページ
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
        >
          次ページ
        </button>
        <label>
          1ページの件数
          <select
            value={table.state.pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            <option value={50}>50件</option>
            <option value={100}>100件</option>
          </select>
        </label>
      </div>
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  options: string[];
  onChange(value: string): void;
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => collator.compare(left, right));
}

function completionFilterValue(value: unknown): CompletionFilter {
  if (value === true) return "completed";
  if (value === false) return "incomplete";
  return "all";
}

function nullableTextSort(
  rowA: { getValue<T>(columnId: string): T },
  rowB: { getValue<T>(columnId: string): T },
  columnId: string,
): number {
  return collator.compare(
    rowA.getValue<string | null>(columnId) ?? "",
    rowB.getValue<string | null>(columnId) ?? "",
  );
}
