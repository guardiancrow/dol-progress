import { describe, expect, it } from "vitest";

import { decodeCp932 } from "./encoding";
import { ImportError } from "./errors";
import { normalizeDiscoveryTable, normalizeQuestTable } from "./normalize";
import {
  cp932JapaneseFixture,
  discoveryTsvFixture,
  invalidCp932Fixture,
  questTsvFixture,
} from "./testFixtures";
import { parseTsv } from "./tsv";
import {
  parseOptionalInteger,
  parsePositiveInteger,
  parseRelationships,
  QUEST_HEADERS,
  validateHeaders,
} from "./validation";

describe("CP932 decoding", () => {
  it("decodes Japanese, half-width kana, and a CP932 extension character", () => {
    expect(decodeCp932(cp932JapaneseFixture)).toBe("日本語 ｶﾅ ①");
  });

  it("rejects malformed byte sequences without replacement characters", () => {
    const error = catchError(() => decodeCp932(invalidCp932Fixture));
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).kind).toBe("DecodeError");
  });
});

describe("TSV parsing and normalization", () => {
  it("handles CRLF, tabs, empty fields, commas, and no final newline", () => {
    const table = parseTsv(questTsvFixture);
    expect(table.rows).toHaveLength(1);
    expect(table.sourceOrders).toEqual([0]);
    expect(table.rows[0]?.["入手アイテム"]).toBe("");
    expect(table.rows[0]?.["発見物"]).toBe("テスト発見物A");
  });

  it("normalizes quest rows while preserving the raw decoded fields", () => {
    const normalized = normalizeQuestTable(parseTsv(questTsvFixture));
    expect(normalized.warnings).toContainEqual(
      expect.objectContaining({ code: "UnknownHeader" }),
    );
    expect(normalized.rows[0]).toMatchObject({
      gvdbId: 100,
      title: "テスト依頼A",
      discoveryName: "テスト発見物A",
      notes: "一行目\n二行目",
      rewardItems: null,
      chainOrder: null,
      sourceOrder: 0,
    });
    expect(normalized.rows[0]).not.toHaveProperty("discoveries");
    expect(JSON.parse(normalized.rows[0]?.rawRowJson ?? "{}")).toMatchObject({
      "クエスト名・地図名": " テスト依頼A ",
      発見物: "テスト発見物A",
      備考: "一行目<br>二行目",
      追加列: "原文保持",
    });
  });

  it("normalizes discovery rows and removes duplicate relations", () => {
    const normalized = normalizeDiscoveryTable(parseTsv(discoveryTsvFixture));
    expect(normalized.rows[0]).toMatchObject({
      gvdbId: 10,
      categoryName: "史跡",
      era: null,
      points: null,
      sourceOrder: 0,
    });
    expect(normalized.rows[0]?.relatedQuests).toEqual([
      { gvdbId: 100, displayName: "テスト依頼A" },
    ]);
  });

  it("accepts LF and a final newline", () => {
    const table = parseTsv(`${discoveryTsvFixture}\n`);
    expect(table.rows).toHaveLength(1);
  });
});

describe("validation", () => {
  it("rejects missing required headers", () => {
    const error = catchError(() =>
      validateHeaders(QUEST_HEADERS.filter((header) => header !== "ID"), QUEST_HEADERS),
    );
    expect((error as ImportError).kind).toBe("HeaderValidationError");
  });

  it("rejects duplicate headers", () => {
    const error = catchError(() =>
      validateHeaders([...QUEST_HEADERS, "ID"], QUEST_HEADERS),
    );
    expect((error as ImportError).kind).toBe("HeaderValidationError");
  });

  it("rejects a header-only dataset before database writes", () => {
    const error = catchError(() =>
      normalizeQuestTable(parseTsv(QUEST_HEADERS.join("\t"))),
    );
    expect((error as ImportError).kind).toBe("RowValidationError");
  });

  it.each(["abc", "1.5", "0x10"])("rejects invalid integers: %s", (value) => {
    const error = catchError(() => parseOptionalInteger(value, "難易度", 2));
    expect((error as ImportError).kind).toBe("RowValidationError");
  });

  it.each(["", "0", "-1", "invalid"])("rejects invalid required IDs: %s", (value) => {
    const error = catchError(() => parsePositiveInteger(value, "ID", 2));
    expect((error as ImportError).kind).toBe("RowValidationError");
  });

  it("rejects invalid relationship IDs", () => {
    const error = catchError(() => parseRelationships("x:名前", "関連クエスト", 2));
    expect((error as ImportError).kind).toBe("RowValidationError");
  });
});

function catchError(action: () => unknown): unknown {
  try {
    action();
    throw new Error("Expected action to throw");
  } catch (error: unknown) {
    return error;
  }
}
