import { ImportError } from "./errors";
import type { ParsedTable } from "./types";

export function parseTsv(source: string): ParsedTable {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0 || lines[0] === "") {
    throw new ImportError(
      "HeaderValidationError",
      "ヘッダー行を取得できませんでした。",
    );
  }

  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((line, index) => {
    const fields = line.split("\t");
    if (fields.length !== headers.length) {
      throw new ImportError(
        "RowValidationError",
        `${index + 2}行目の列数がヘッダーと一致しません。`,
        `row ${index + 2}: expected ${headers.length} fields, got ${fields.length}`,
      );
    }

    return Object.fromEntries(
      headers.map((header, fieldIndex) => [header, fields[fieldIndex] ?? ""]),
    );
  });

  return { headers, rows, sourceOrders: rows.map((_row, index) => index) };
}
