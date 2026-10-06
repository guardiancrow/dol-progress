import { describe, expect, it } from "vitest";

import { StubDatabase } from "../test/stubDatabase";
import { MasterDataStatusRepository } from "./masterDataStatusRepository";

describe("MasterDataStatusRepository", () => {
  it("loads both active counts and recent history in two read queries", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ dataset: "quests", activeCount: 3 }, { dataset: "discoveries", activeCount: 2 }],
      [
        { id: 2, dataset: "discoveries", fileName: "discovery_items.csv", rowCount: 2, sourceMaxUpdatedAt: "2026-01-02", importedAt: "2026-01-03T00:00:00.000Z" },
        { id: 1, dataset: "quests", fileName: "quests.csv", rowCount: 3, sourceMaxUpdatedAt: "2026-01-01", importedAt: "2026-01-03T00:00:00.000Z" },
      ],
    );
    const repository = new MasterDataStatusRepository(async () => database);

    const status = await repository.getStatus();

    expect(status.datasets.quests.activeCount).toBe(3);
    expect(status.datasets.quests.latestImport?.fileName).toBe("quests.csv");
    expect(status.datasets.discoveries.activeCount).toBe(2);
    expect(status.recentHistory).toHaveLength(2);
    expect(database.selectCalls).toHaveLength(2);
    expect(database.executeCalls).toHaveLength(0);
  });

  it("returns zero counts and null latest imports for an empty database", async () => {
    const database = new StubDatabase();
    database.selectResults.push([], []);
    const repository = new MasterDataStatusRepository(async () => database);

    await expect(repository.getStatus()).resolves.toMatchObject({
      datasets: {
        quests: { activeCount: 0, latestImport: null },
        discoveries: { activeCount: 0, latestImport: null },
      },
      recentHistory: [],
    });
  });
});
