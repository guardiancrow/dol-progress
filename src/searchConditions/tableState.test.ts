import { describe, expect, it } from "vitest";
import type { QuestRowViewModel } from "../quests/types";
import { decodeSearchCondition, type DiscoverySearchCondition, type QuestSearchCondition } from "./definition";
import { captureSearchCondition, DISCOVERY_CATEGORY_PREFIX, questSearchOptions, RANK_COLUMN_ID, resolveDiscoverySearch, resolveQuestSearch } from "./tableState";

const questCondition: QuestSearchCondition = {
  schemaVersion: 1, page: "quests", search: " 合成依頼 ",
  filters: {
    completed: false, prerequisiteStatus: "satisfied", successorStatus: "present", offerMethod: { kind: "group", value: "quest" },
    offerCity: { kind: "named", name: "ロンドン" }, requiredSkills: "探索", discoveries: { kind: "named", name: "史跡" },
    mapState: "candidate", progressReview: true,
  },
  sorting: [{ key: "requiredSkillRank", direction: "desc" }],
};

const discoveryCondition: DiscoverySearchCondition = {
  schemaVersion: 1, page: "discoveries", search: "史跡",
  filters: { category: { kind: "named", name: "史跡" }, status: "unreported", cardOwned: false, unreportedBreakdown: "confirmed", mapReacquisition: "related" },
  sorting: [{ key: "category", direction: "asc" }, { key: "rank", direction: "desc" }],
};

const questRow: QuestRowViewModel = {
  id: 1, title: "合成依頼", notes: null, difficulty: null, offerMethod: "冒険クエスト", offerCity: "ロンドン",
  offerCities: ["ロンドン"], requiredSkills: "探索", requiredSkillNames: ["探索"],
  requiredSkillsNormalized: [{ skillName: "探索", requiredRank: 3 }],
  discoveries: [{ id: 8, name: "合成史跡", description: null, notes: null, categoryId: 27, categoryName: "史跡", categorySortOrder: 2 }],
  completed: false, updating: false, prerequisiteStatus: "NONE", directPrerequisites: [],
};

describe("search condition v1", () => {
  it.each([
    [null, "definition"],
    [{ ...questCondition, schemaVersion: "1" }, "schemaVersion"],
    [{ ...questCondition, page: "overview" }, "page"],
    [{ ...questCondition, profileId: 1 }, "profileId"],
    [{ ...questCondition, search: 4 }, "search"],
    [{ ...questCondition, filters: { completed: "false" } }, "completed"],
    [{ ...questCondition, filters: { progressReview: false } }, "progressReview"],
    [{ ...questCondition, filters: { offerCity: { kind: "named", name: " " } } }, "offerCity"],
    [{ ...questCondition, filters: { offerCity: { kind: "unset", name: "ロンドン" } } }, "offerCity"],
    [{ ...questCondition, filters: { mapState: "related" } }, "mapState"],
    [{ ...discoveryCondition, filters: { successorStatus: "present" } }, "successorStatus"],
    [{ ...discoveryCondition, filters: { status: "all" } }, "status"],
    [{ ...discoveryCondition, filters: { category: 27 } }, "category"],
    [{ ...discoveryCondition, filters: { mapReacquisition: "all" } }, "mapReacquisition"],
    [{ ...discoveryCondition, sorting: [{ key: "reported", direction: "asc" }] }, "sorting"],
    [{ ...discoveryCondition, sorting: [{ key: "rank", direction: "down" }] }, "sorting"],
    [{ ...discoveryCondition, sorting: [discoveryCondition.sorting[0], discoveryCondition.sorting[0]] }, "sorting"],
    [{ ...questCondition, filters: {} }, "requiredSkillRank"],
    [{ ...questCondition, sorting: [...questCondition.sorting, { key: "title", direction: "asc" }] }, "requiredSkillRank"],
  ])("rejects invalid definition %j", (definition, field) => {
    expect(decodeSearchCondition(definition)).toEqual({ status: "blocked", issue: { kind: "invalid", field } });
  });

  it("rejects future versions before decoding their conditions and copies recognized input", () => {
    expect(decodeSearchCondition({ schemaVersion: 2, unknownPayload: [] })).toEqual({
      status: "blocked", issue: { kind: "unsupported-version", field: "schemaVersion", value: "2" },
    });
    const decoded = decodeSearchCondition(questCondition);
    expect(decoded).toEqual({ status: "ready", value: questCondition });
    if (decoded.status === "ready") expect(decoded.value.filters).not.toBe(questCondition.filters);
  });

  it("round-trips quest filters, including candidate review and the selected skill rank", () => {
    const options = questSearchOptions([questRow]);
    const result = resolveQuestSearch(questCondition, options);
    expect(result).toMatchObject({ status: "ready", value: {
      columnFilters: expect.arrayContaining([
        { id: "title", value: " 合成依頼 " }, { id: "completed", value: false }, { id: "progressReview", value: true },
        { id: "discoveries", value: `${DISCOVERY_CATEGORY_PREFIX}27` }, { id: "offerCity", value: "city:ロンドン" },
      ]), sorting: [{ id: RANK_COLUMN_ID, desc: true }],
    } });
    if (result.status !== "ready") throw new Error("Expected valid quest conditions");
    expect(captureSearchCondition({ page: "quests", options }, result.value)).toEqual({ status: "ready", value: questCondition });
  });

  it("round-trips discovery filters with the current category ID and ordered sort rules", () => {
    const options = { categories: [{ id: 95, name: "史跡", sortOrder: 2 }], hasUncategorized: false };
    const result = resolveDiscoverySearch(discoveryCondition, options);
    expect(result).toMatchObject({ status: "ready", value: {
      columnFilters: expect.arrayContaining([{ id: "category", value: 95 }, { id: "cardOwned", value: false }, { id: "mapReacquisition", value: "related" }]),
      sorting: [{ id: "category", desc: false }, { id: "rank", desc: true }],
    } });
    if (result.status !== "ready") throw new Error("Expected valid discovery conditions");
    expect(captureSearchCondition({ page: "discoveries", options }, result.value)).toEqual({ status: "ready", value: discoveryCondition });
  });

  it("keeps exact master values separate from sentinels and detects missing choices", () => {
    const conditions: QuestSearchCondition = { ...questCondition, filters: { offerCity: { kind: "named", name: "unset" } }, sorting: [] };
    expect(resolveQuestSearch(conditions, questSearchOptions([questRow]))).toEqual({
      status: "blocked", issue: { kind: "unavailable", field: "offerCity", value: "unset" },
    });
    const options = questSearchOptions([{ ...questRow, offerCities: ["unset"] }]);
    expect(resolveQuestSearch(conditions, options)).toMatchObject({ status: "ready", value: { columnFilters: expect.arrayContaining([{ id: "offerCity", value: "city:unset" }]) } });
    expect(resolveQuestSearch(questCondition, questSearchOptions([{ ...questRow, requiredSkillsNormalized: [] }]))).toMatchObject({
      status: "blocked", issue: { field: "requiredSkillRank" },
    });
    expect(resolveDiscoverySearch(discoveryCondition, { categories: [], hasUncategorized: false })).toMatchObject({
      status: "blocked", issue: { field: "category", value: "史跡" },
    });
    expect(resolveDiscoverySearch({ ...discoveryCondition, filters: { category: { kind: "unset" } } }, { categories: [], hasUncategorized: false }))
      .toMatchObject({ status: "ready", value: { columnFilters: expect.arrayContaining([{ id: "category", value: "unset" }]) } });
  });
});
