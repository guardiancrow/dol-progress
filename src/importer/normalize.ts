import { ImportError } from "./errors";
import type {
  ImportWarning,
  NormalizedDiscoveryImportRow,
  NormalizedQuestImportRow,
  ParsedTable,
} from "./types";
import {
  DISCOVERY_HEADERS,
  normalizeText,
  parseOptionalInteger,
  parsePositiveInteger,
  parseRelationships,
  QUEST_HEADERS,
  requireText,
  validateHeaders,
} from "./validation";

export interface NormalizedQuestDataset {
  rows: NormalizedQuestImportRow[];
  warnings: ImportWarning[];
}

export interface NormalizedDiscoveryDataset {
  rows: NormalizedDiscoveryImportRow[];
  warnings: ImportWarning[];
}

export function normalizeQuestTable(table: ParsedTable): NormalizedQuestDataset {
  const warnings = validateHeaders(table.headers, QUEST_HEADERS);
  requireDataRows(table);
  const rows = table.rows.map((raw, index) => {
    const rowNumber = index + 2;
    return {
      gvdbId: parsePositiveInteger(raw.ID ?? "", "ID", rowNumber),
      sourceOrder: table.sourceOrders[index] ?? index,
      title: requireText(
        raw["クエスト名・地図名"] ?? "",
        "クエスト名・地図名",
        rowNumber,
      ),
      difficulty: parseOptionalInteger(
        raw["難易度"] ?? "",
        "難易度",
        rowNumber,
      ),
      chronoQuest: normalizeText(raw["クロノクエスト"] ?? ""),
      offerMethod: normalizeText(raw["オファー方法"] ?? ""),
      offerCity: normalizeText(raw["オファー都市"] ?? ""),
      requiredSkills: normalizeText(raw["必要スキル"] ?? ""),
      discoveryTypeText: normalizeText(raw["発見物種類"] ?? ""),
      discoveryName: normalizeText(raw["発見物"] ?? ""),
      rewardItems: normalizeText(raw["入手アイテム"] ?? ""),
      notes: normalizeText(raw["備考"] ?? ""),
      sourceUpdatedAt: normalizeText(raw["最終更新日時"] ?? ""),
      chainName: normalizeText(raw["連続クエスト名"] ?? ""),
      chainOrder: parseOptionalInteger(
        raw["順序"] ?? "",
        "順序",
        rowNumber,
      ),
      prerequisites: parseRelationships(
        raw["前提クエスト"] ?? "",
        "前提クエスト",
        rowNumber,
      ),
      dependents: parseRelationships(
        raw["後続クエスト"] ?? "",
        "後続クエスト",
        rowNumber,
      ),
      rawRowJson: JSON.stringify(raw),
    } satisfies NormalizedQuestImportRow;
  });
  return { rows: deduplicate(rows, warnings, "quest"), warnings };
}

export function normalizeDiscoveryTable(
  table: ParsedTable,
): NormalizedDiscoveryDataset {
  const warnings = validateHeaders(table.headers, DISCOVERY_HEADERS);
  requireDataRows(table);
  const rows = table.rows.map((raw, index) => {
    const rowNumber = index + 2;
    return {
      gvdbId: parsePositiveInteger(raw.ID ?? "", "ID", rowNumber),
      sourceOrder: table.sourceOrders[index] ?? index,
      categoryName: normalizeText(raw["種別"] ?? ""),
      name: requireText(raw["発見物名"] ?? "", "発見物名", rowNumber),
      rank: parseOptionalInteger(raw["ランク"] ?? "", "ランク", rowNumber),
      description: normalizeText(raw["説明"] ?? ""),
      era: normalizeText(raw["時代"] ?? ""),
      points: parseOptionalInteger(
        raw["ポイント"] ?? "",
        "ポイント",
        rowNumber,
      ),
      difficulty: parseOptionalInteger(
        raw["難易度"] ?? "",
        "難易度",
        rowNumber,
      ),
      experience: parseOptionalInteger(
        raw["経験値"] ?? "",
        "経験値",
        rowNumber,
      ),
      notes: normalizeText(raw["備考"] ?? ""),
      sourceUpdatedAt: normalizeText(raw["最終更新日時"] ?? ""),
      relatedQuests: parseRelationships(
        raw["関連クエスト"] ?? "",
        "関連クエスト",
        rowNumber,
      ),
      rawRowJson: JSON.stringify(raw),
    } satisfies NormalizedDiscoveryImportRow;
  });
  return { rows: deduplicate(rows, warnings, "discovery"), warnings };
}

function requireDataRows(table: ParsedTable): void {
  if (table.rows.length === 0) {
    throw new ImportError(
      "RowValidationError",
      "データ行が存在しないファイルはインポートできません。",
    );
  }
}

function deduplicate<T extends { gvdbId: number; sourceOrder: number }>(
  rows: T[],
  warnings: ImportWarning[],
  entity: string,
): T[] {
  const unique = new Map<number, T>();
  for (const row of rows) {
    const previous = unique.get(row.gvdbId);
    if (!previous) {
      unique.set(row.gvdbId, row);
      continue;
    }
    const { sourceOrder: _previousSourceOrder, ...previousData } = previous;
    const { sourceOrder: _rowSourceOrder, ...rowData } = row;
    if (JSON.stringify(previousData) !== JSON.stringify(rowData)) {
      throw new ImportError(
        "RowValidationError",
        `同じIDに矛盾する${entity}行があります: ${row.gvdbId}`,
      );
    }
    warnings.push({
      code: "DuplicatePrimaryId",
      message: `完全に同一の重複IDを1件にまとめました: ${row.gvdbId}`,
    });
  }
  return [...unique.values()];
}
