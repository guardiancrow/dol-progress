import { describe, expect, it } from "vitest";

import { StubDatabase } from "../test/stubDatabase";
import { ImportHistoryReader } from "./importHistory";

describe("ImportHistoryReader", () => {
  it.each([
    ["quests", "quests"],
    ["discoveries", "discoveries"],
  ] as const)(
    "allows one same-hash metadata completion check for %s when active source order is incomplete",
    async (dataset, masterTable) => {
      const database = new StubDatabase();
      database.selectResults.push([{ imported: 0 }]);
      const reader = new ImportHistoryReader(async () => database);

      await expect(reader.contains(dataset, "same-hash")).resolves.toBe(false);
      expect(database.selectCalls[0]?.sql).toContain(
        `FROM ${masterTable}\n         WHERE is_active = 1 AND source_order IS NULL`,
      );
      expect(database.selectCalls[0]?.parameters).toEqual([dataset, "same-hash"]);
    },
  );

  it("keeps a completed same-hash import blocked", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ imported: 1 }]);
    const reader = new ImportHistoryReader(async () => database);

    await expect(reader.contains("quests", "same-hash")).resolves.toBe(true);
  });
});
