import { describe, expect, it } from "vitest";

import { StubDatabase } from "../test/stubDatabase";
import { DiscoveryRepository } from "./discoveryRepository";
import { QuestRepository } from "./questRepository";

const questRow = {
  id: 10,
  gvdbId: 100,
  title: "テスト依頼A",
  difficulty: 10,
  chronoQuest: null,
  offerMethod: "冒険者依頼仲介人",
  offerCity: "セビリア",
  requiredSkills: "視認",
  discoveryTypeText: "史跡",
  rewardItems: null,
  notes: null,
  chainName: null,
  chainOrder: null,
  sourceUpdatedAt: "元日時",
  isActive: 1,
  rawRowJson: "{}",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const discoveryRow = {
  id: 20,
  gvdbId: 200,
  categoryId: 3,
  name: "発見物",
  rank: 5,
  description: "説明",
  era: null,
  points: 10,
  difficulty: 5,
  experience: 100,
  notes: null,
  sourceUpdatedAt: "元日時",
  isActive: 0,
  rawRowJson: "{}",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("QuestRepository", () => {
  it("loads all dependency edges in one read-only query", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ questId: 20, prerequisiteQuestId: 10 }]);
    const repository = new QuestRepository(async () => database);

    await expect(repository.listDependencies()).resolves.toEqual([
      { questId: 20, prerequisiteQuestId: 10 },
    ]);
    expect(database.selectCalls).toHaveLength(1);
    expect(database.selectCalls[0]?.sql).toContain("FROM quest_dependencies");
    expect(database.executeCalls).toHaveLength(0);
  });

  it("provides the required read APIs and maps SQLite flags", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [questRow],
      [questRow],
      [questRow],
      [questRow],
    );
    const repository = new QuestRepository(async () => database);

    await expect(repository.getById(10)).resolves.toMatchObject({
      id: 10,
      isActive: true,
    });
    await expect(repository.getByGvdbId(100)).resolves.toMatchObject({
      gvdbId: 100,
    });
    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(repository.searchByTitle("世界")).resolves.toHaveLength(1);

    expect(database.selectCalls[0]?.parameters).toEqual([10]);
    expect(database.selectCalls[1]?.parameters).toEqual([100]);
    expect(database.selectCalls[3]?.parameters).toEqual(["世界"]);
    expect(database.selectCalls[3]?.sql).not.toContain("'世界'");
    expect(database.selectCalls[2]?.sql).toContain(
      "ORDER BY source_order IS NULL, source_order, id",
    );
    expect(database.selectCalls[3]?.sql).toContain(
      "ORDER BY source_order IS NULL, source_order, id",
    );
    expect(database.executeCalls).toHaveLength(0);
  });

  it("loads quests and related discoveries in one read query", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [
        { ...questRow, discoveryId: 20, discoveryName: "発見物A", categoryId: 3, categoryName: "史跡", categorySortOrder: 2 },
        { ...questRow, discoveryId: 21, discoveryName: "発見物B", categoryId: 4, categoryName: "天文", categorySortOrder: 1 },
        {
          ...questRow,
          id: 11,
          gvdbId: 101,
          title: "関連なし",
          discoveryId: null,
          discoveryName: null,
          categoryId: null,
          categoryName: null,
          categorySortOrder: null,
        },
      ],
      [{ questId: 10, position: 0, skillName: "日本語", requiredRank: null, isLanguage: 1 }],
      [{ questId: 10, position: 0, cityName: "セビリア" }],
    );
    const repository = new QuestRepository(async () => database);

    await expect(repository.listWithDiscoveries()).resolves.toEqual([
      {
        quest: expect.objectContaining({ id: 10, title: "テスト依頼A" }),
        discoveries: [
          { id: 20, name: "発見物A", categoryId: 3, categoryName: "史跡", categorySortOrder: 2 },
          { id: 21, name: "発見物B", categoryId: 4, categoryName: "天文", categorySortOrder: 1 },
        ],
        requiredSkillsNormalized: [
          { position: 0, skillName: "日本語", requiredRank: null, isLanguage: true },
        ],
        offerCities: [{ position: 0, cityName: "セビリア" }],
      },
      {
        quest: expect.objectContaining({ id: 11, title: "関連なし" }),
        discoveries: [],
        requiredSkillsNormalized: [],
        offerCities: [],
      },
    ]);
    expect(database.selectCalls).toHaveLength(3);
    expect(database.selectCalls[0]?.sql).toContain("LEFT JOIN quest_discoveries");
    expect(database.selectCalls[0]?.sql).toContain("LEFT JOIN discovery_categories");
    expect(database.selectCalls[0]?.sql).not.toContain("d.is_active = 1");
    expect(database.selectCalls[0]?.sql).toContain(
      "ORDER BY q.source_order IS NULL, q.source_order, q.id, d.id",
    );
    expect(database.selectCalls[1]?.sql).toContain("quest_required_skills");
    expect(database.selectCalls[2]?.sql).toContain("quest_offer_cities");
    expect(database.executeCalls).toHaveLength(0);
  });
});

describe("DiscoveryRepository", () => {
  it("provides the required read APIs with parameter binding", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [discoveryRow],
      [discoveryRow],
      [discoveryRow],
      [discoveryRow],
      [discoveryRow],
    );
    const repository = new DiscoveryRepository(async () => database);

    await expect(repository.getById(20)).resolves.toMatchObject({
      id: 20,
      isActive: false,
    });
    await expect(repository.getByGvdbId(200)).resolves.toMatchObject({
      gvdbId: 200,
    });
    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(repository.searchByName("発見")).resolves.toHaveLength(1);
    await expect(repository.getByCategory(3)).resolves.toHaveLength(1);

    expect(database.selectCalls[0]?.parameters).toEqual([20]);
    expect(database.selectCalls[1]?.parameters).toEqual([200]);
    expect(database.selectCalls[3]?.parameters).toEqual(["発見"]);
    expect(database.selectCalls[4]?.parameters).toEqual([3]);
    expect(database.selectCalls[2]?.sql).toContain(
      "ORDER BY source_order IS NULL, source_order, id",
    );
    expect(database.selectCalls[3]?.sql).toContain(
      "ORDER BY source_order IS NULL, source_order, id",
    );
    expect(database.selectCalls[4]?.sql).toContain(
      "ORDER BY source_order IS NULL, source_order, id",
    );
    expect(database.executeCalls).toHaveLength(0);
  });

  it("loads category and related quests with one batch query", async () => {
    const database = new StubDatabase();
    database.selectResults.push([
      {
        ...discoveryRow,
        categoryName: "史跡",
        categorySortOrder: 4,
        relatedQuestId: 10,
        relatedQuestTitle: "テスト依頼A",
      },
      {
        ...discoveryRow,
        categoryName: "史跡",
        categorySortOrder: 4,
        relatedQuestId: 11,
        relatedQuestTitle: "古代の調査",
      },
    ]);
    const repository = new DiscoveryRepository(async () => database);

    await expect(repository.listWithRelations()).resolves.toEqual([
      {
        discovery: expect.objectContaining({ id: 20, name: "発見物" }),
        category: { id: 3, name: "史跡", sortOrder: 4 },
        relatedQuests: [
          { id: 10, title: "テスト依頼A" },
          { id: 11, title: "古代の調査" },
        ],
      },
    ]);
    expect(database.selectCalls).toHaveLength(1);
    expect(database.selectCalls[0]?.sql).toContain("LEFT JOIN discovery_categories");
    expect(database.selectCalls[0]?.sql).toContain("LEFT JOIN quest_discoveries");
    expect(database.selectCalls[0]?.sql).toContain("q.is_active = 1");
    expect(database.selectCalls[0]?.sql).toContain(
      "ORDER BY d.source_order IS NULL, d.source_order, d.id, q.id",
    );
  });
});
