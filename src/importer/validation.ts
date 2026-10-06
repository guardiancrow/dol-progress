import { ImportError } from "./errors";
import type { ImportWarning, RelationshipReference } from "./types";

export const QUEST_HEADERS = [
  "ID",
  "クエスト名・地図名",
  "難易度",
  "クロノクエスト",
  "オファー方法",
  "オファー都市",
  "必要スキル",
  "発見物種類",
  "発見物",
  "入手アイテム",
  "備考",
  "最終更新日時",
  "連続クエスト名",
  "順序",
  "前提クエスト",
  "後続クエスト",
] as const;

export const DISCOVERY_HEADERS = [
  "ID",
  "種別",
  "発見物名",
  "ランク",
  "説明",
  "時代",
  "ポイント",
  "難易度",
  "経験値",
  "備考",
  "最終更新日時",
  "関連クエスト",
] as const;

export function validateHeaders(
  headers: string[],
  requiredHeaders: readonly string[],
): ImportWarning[] {
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    throw new ImportError(
      "HeaderValidationError",
      `重複したヘッダーがあります: ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  const available = new Set(headers);
  const missing = requiredHeaders.filter((header) => !available.has(header));
  if (missing.length > 0) {
    throw new ImportError(
      "HeaderValidationError",
      `必要なヘッダーが不足しています: ${missing.join(", ")}`,
      JSON.stringify({ missing }),
    );
  }

  const expected = new Set(requiredHeaders);
  return headers
    .filter((header) => !expected.has(header))
    .map((header) => ({
      code: "UnknownHeader",
      message: `未知の追加ヘッダーを保持します: ${header}`,
    }));
}

export function parsePositiveInteger(
  value: string,
  field: string,
  rowNumber: number,
): number {
  const parsed = parseInteger(value, field, rowNumber, false);
  if (parsed === null || parsed <= 0) {
    throw rowError(rowNumber, field, "正整数が必要です", value);
  }
  return parsed;
}

export function parseOptionalInteger(
  value: string,
  field: string,
  rowNumber: number,
): number | null {
  return parseInteger(value, field, rowNumber, true);
}

export function normalizeText(value: string): string | null {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .trim();
  return normalized === "" ? null : normalized;
}

export function requireText(
  value: string,
  field: string,
  rowNumber: number,
): string {
  const normalized = normalizeText(value);
  if (normalized === null) {
    throw rowError(rowNumber, field, "空欄にできません", value);
  }
  return normalized;
}

export function parseRelationships(
  value: string,
  field: string,
  rowNumber: number,
): RelationshipReference[] {
  if (value.trim() === "") {
    return [];
  }

  const unique = new Map<number, RelationshipReference>();
  for (const item of value.split(",")) {
    const separator = item.indexOf(":");
    if (separator < 0) {
      throw rowError(rowNumber, field, "関連項目に ':' がありません", item);
    }
    const gvdbId = parsePositiveInteger(
      item.slice(0, separator).trim(),
      field,
      rowNumber,
    );
    if (!unique.has(gvdbId)) {
      unique.set(gvdbId, {
        gvdbId,
        displayName: item.slice(separator + 1).trim(),
      });
    }
  }
  return [...unique.values()];
}

function parseInteger(
  value: string,
  field: string,
  rowNumber: number,
  optional: boolean,
): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (optional) {
      return null;
    }
    throw rowError(rowNumber, field, "空欄にできません", value);
  }
  if (!/^-?\d+$/.test(trimmed)) {
    throw rowError(rowNumber, field, "整数ではありません", value);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw rowError(rowNumber, field, "安全に扱える整数の範囲外です", value);
  }
  return parsed;
}

function rowError(
  rowNumber: number,
  field: string,
  reason: string,
  value: string,
): ImportError {
  return new ImportError(
    "RowValidationError",
    `${rowNumber}行目の「${field}」が不正です。`,
    `${reason}: ${JSON.stringify(value)}`,
  );
}
