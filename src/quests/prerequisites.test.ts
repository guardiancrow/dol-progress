import { describe, expect, it } from "vitest";

import { derivePrerequisiteStatuses, type QuestDependency } from "./prerequisites";

function quest(
  id: number,
  prerequisites: number[] = [],
  successors: number[] = [],
  offerMethod = "冒険クエスト",
  isActive = true,
) {
  return {
    id,
    gvdbId: id + 1000,
    offerMethod,
    isActive,
    rawRowJson: JSON.stringify({
      前提クエスト: prerequisites.map((item) => `${item + 1000}:Quest ${item}`).join(","),
      後続クエスト: successors.map((item) => `${item + 1000}:Quest ${item}`).join(","),
    }),
  };
}

function edge(questId: number, prerequisiteQuestId: number): QuestDependency {
  return { questId, prerequisiteQuestId };
}

describe("direct prerequisite status", () => {
  it("returns NONE without a direct edge", () => {
    expect(derivePrerequisiteStatuses([quest(1)], [], new Set()).get(1)).toBe("NONE");
  });

  it("separates completed and incomplete single ordinary prerequisites by profile", () => {
    const quests = [quest(1, [], [2]), quest(2, [1])];
    const edges = [edge(2, 1)];
    expect(derivePrerequisiteStatuses(quests, edges, new Set([1])).get(2)).toBe("SATISFIED");
    expect(derivePrerequisiteStatuses(quests, edges, new Set()).get(2)).toBe("UNSATISFIED");
  });

  it("only resolves multiple ordinary predecessors when all are completed", () => {
    const quests = [quest(1, [], [3]), quest(2, [], [3]), quest(3, [1, 2])];
    const edges = [edge(3, 1), edge(3, 2)];
    expect(derivePrerequisiteStatuses(quests, edges, new Set([1, 2])).get(3)).toBe("SATISFIED");
    expect(derivePrerequisiteStatuses(quests, edges, new Set([1])).get(3)).toBe("UNKNOWN");
    expect(derivePrerequisiteStatuses(quests, edges, new Set()).get(3)).toBe("UNKNOWN");
  });

  it("keeps map, unsupported and inactive predecessors UNKNOWN even when completed", () => {
    for (const predecessor of [
      quest(1, [], [2], "生物学"),
      quest(1, [], [2], "レガシー"),
      quest(1, [], [2], "冒険クエスト", false),
    ]) {
      const statuses = derivePrerequisiteStatuses(
        [predecessor, quest(2, [1])], [edge(2, 1)], new Set([1]),
      );
      expect(statuses.get(2)).toBe("UNKNOWN");
    }
  });

  it("treats missing or one-sided relations as UNKNOWN without crashing", () => {
    expect(derivePrerequisiteStatuses([quest(2, [1])], [], new Set()).get(2)).toBe("UNKNOWN");
    expect(derivePrerequisiteStatuses([quest(2)], [edge(2, 1)], new Set()).get(2)).toBe("UNKNOWN");
    expect(derivePrerequisiteStatuses(
      [quest(1, [], [2]), quest(2)], [edge(2, 1)], new Set([1]),
    ).get(2)).toBe("UNKNOWN");
    expect(derivePrerequisiteStatuses(
      [quest(1), quest(2, [1])], [edge(2, 1)], new Set([1]),
    ).get(2)).toBe("UNKNOWN");
  });

  it("bounds a cycle and marks affected statuses UNKNOWN", () => {
    const quests = [quest(1, [2], [2]), quest(2, [1], [1])];
    const statuses = derivePrerequisiteStatuses(quests, [edge(1, 2), edge(2, 1)], new Set([1, 2]));
    expect(statuses.get(1)).toBe("UNKNOWN");
    expect(statuses.get(2)).toBe("UNKNOWN");
  });
});
