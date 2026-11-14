import { describe, expect, it } from "vitest";
import { buildPrerequisiteReviewIndex, derivePrerequisiteProgressReview } from "./prerequisiteProgressReview";
import { derivePrerequisiteStatuses, type QuestDependency } from "./prerequisites";

function quest(id: number, predecessors: number[] = [], successors: number[] = [], offerMethod = "冒険クエスト", isActive = true) {
  return { id, gvdbId: id + 1000, title: `合成クエスト${id}`, offerMethod, isActive,
    rawRowJson: JSON.stringify({ 前提クエスト: predecessors.map(id => `${id + 1000}:合成`).join(","), 後続クエスト: successors.map(id => `${id + 1000}:合成`).join(",") }) };
}
const edge = (questId: number, prerequisiteQuestId: number): QuestDependency => ({ questId, prerequisiteQuestId });
const base = () => [quest(1, [], [2]), quest(2, [1])];
function review(quests = base(), edges = [edge(2, 1)], completed: number[] = [2]) {
  const index = buildPrerequisiteReviewIndex(quests, edges);
  const statuses = derivePrerequisiteStatuses(quests, edges, new Set(completed));
  return { index, statuses, candidates: derivePrerequisiteProgressReview(index, new Set(completed), statuses) };
}

describe("read-only prerequisite progress review", () => {
  it.each([[[], 0], [[1], 0], [[1, 2], 0], [[2], 1]] as [number[], number][])("requires a completed successor and incomplete predecessor (%j)", (completed, count) => {
    expect(review(base(), [edge(2, 1)], completed).candidates).toHaveLength(count);
  });
  it("includes both identities, states and a reason without changing input", () => {
    const quests = base(), edges = [edge(2, 1)], original = structuredClone({ quests, edges });
    expect(review(quests, edges).candidates).toEqual([{
      successor: { id: 2, gvdbId: 1002, title: "合成クエスト2" }, prerequisite: { id: 1, gvdbId: 1001, title: "合成クエスト1" },
      successorCompleted: true, prerequisiteCompleted: false, reason: "single_direct_prerequisite_unrecorded",
    }]);
    expect({ quests, edges }).toEqual(original);
  });
  it("has no candidate without a direct edge", () => {
    expect(review([quest(1), quest(2)], [], [2]).candidates).toEqual([]);
  });
  it("excludes multiple direct predecessors without guessing AND/OR", () => {
    expect(review([quest(1, [], [3]), quest(2, [], [3]), quest(3, [1, 2])], [edge(3, 1), edge(3, 2)], [3]).candidates).toEqual([]);
  });
  it.each(["地理学", "収奪・陸戦地図", "レガシー", "追究クエスト", "トレジャーハント", ""])("excludes a %s predecessor and successor", method => {
    for (const index of [0, 1]) {
      const quests = base(); quests[index]!.offerMethod = method;
      expect(review(quests).candidates).toEqual([]);
    }
  });
  it.each(["冒険クエスト", "交易クエスト", "海事クエスト"])("accepts exact ordinary method %s", method => {
    expect(review([quest(1, [], [2], method), quest(2, [1], [], method)]).candidates).toHaveLength(1);
  });
  it.each([0, 1])("excludes inactive endpoint %i", index => {
    const quests = base(); quests[index]!.isActive = false;
    expect(review(quests).candidates).toEqual([]);
  });
  it.each([0, 1])("excludes missing reciprocal raw references on endpoint %i", index => {
    const quests = base(); quests[index]!.rawRowJson = "{}";
    expect(review(quests).candidates).toEqual([]);
  });
  it.each([
    "not-json", "[]", "null", '{"前提クエスト":1}', '{"前提クエスト":"0:不正"}',
    '{"前提クエスト":"-1:不正"}', '{"前提クエスト":"9007199254740992:不正"}',
    '{"前提クエスト":"1001:合成,1001:重複"}', '{"前提クエスト":"1001:合成,"}',
  ])("excludes malformed raw references %s", rawRowJson => {
    const quests = base(); quests[1]!.rawRowJson = rawRowJson;
    expect(review(quests).candidates).toEqual([]);
  });
  it("checks original edge multiplicity rather than the deduplicated display list", () => {
    const result = review(base(), [edge(2, 1), edge(2, 1)]);
    expect(result.candidates).toEqual([]);
    expect(result.index.excluded.get(2)).toContain("duplicate_edge");
  });
  it("excludes missing local or GVDB references", () => {
    expect(review([quest(2, [1])], [edge(2, 1)]).candidates).toEqual([]);
    expect(review([quest(1, [], [2, 99]), quest(2, [1])]).candidates).toEqual([]);
    expect(review([quest(1, [], [2]), quest(2, [1])], [edge(2, 1), edge(99, 1)]).candidates).toEqual([]);
  });
  it("propagates structural ancestor failures that the existing status does not propagate", () => {
    const result = review([quest(1, [99], [2]), quest(2, [1])]);
    expect(result.statuses.get(2)).toBe("UNSATISFIED");
    expect(result.candidates).toEqual([]);
    expect(result.index.excluded.get(2)).toContain("affected_ancestor");
  });
  it("terminates on a cycle and excludes its downstream while retaining an independent branch", () => {
    const result = review([quest(1, [2], [2]), quest(2, [1], [1, 3]), quest(3, [2]), quest(4, [], [5]), quest(5, [4])],
      [edge(1, 2), edge(2, 1), edge(3, 2), edge(5, 4)], [3, 5]);
    expect(result.candidates.map(c => [c.successor.id, c.prerequisite.id])).toEqual([[5, 4]]);
  });
  it("rejects self references", () => {
    expect(review([quest(1, [1], [1])], [edge(1, 1)], [1]).index.excluded.get(1)).toContain("self_reference");
  });
  it("does not poison a safe sibling pair when another successor lacks a canonical edge", () => {
    const result = review([quest(1, [], [2, 3]), quest(2, [1]), quest(3, [1])], [edge(2, 1)], [2, 3]);
    expect(result.candidates.map(c => c.successor.id)).toEqual([2]);
  });
  it("retains a safe direct pair despite multiple, special or inactive ancestors", () => {
    const result = review([quest(1, [], [3], "地理学", false), quest(2, [], [3]), quest(3, [1, 2], [4]), quest(4, [3])],
      [edge(3, 1), edge(3, 2), edge(4, 3)], [4]);
    expect(result.statuses.get(3)).toBe("UNKNOWN");
    expect(result.candidates.map(c => [c.successor.id, c.prerequisite.id])).toEqual([[4, 3]]);
  });
  it("only emits B to C when C is completed, never indirect A to C", () => {
    expect(review([quest(1, [], [2]), quest(2, [1], [3]), quest(3, [2])], [edge(2, 1), edge(3, 2)], [3])
      .candidates.map(c => [c.successor.id, c.prerequisite.id])).toEqual([[3, 2]]);
  });
  it("uses master order and IDs, not names or dependency retrieval order", () => {
    const quests = [quest(4, [3]), quest(3, [], [4]), quest(2, [1]), quest(1, [], [2])].map(q => ({ ...q, title: "同名" }));
    const a = review(quests, [edge(2, 1), edge(4, 3)], [2, 4]).candidates;
    expect(a.map(c => c.successor.gvdbId)).toEqual([1004, 1002]);
    expect(review(quests, [edge(4, 3), edge(2, 1)], [2, 4]).candidates).toEqual(a);
  });
  it("rejects duplicate identities and unsafe local IDs", () => {
    const quests = base(); quests.push({ ...quest(3), gvdbId: 1001 });
    expect(review(quests).candidates).toEqual([]);
    expect(review([...base(), quest(1)]).candidates).toEqual([]);
    expect(review([{ ...quest(1, [], [2]), id: 0 }, quest(2, [1])], [edge(2, 0)]).candidates).toEqual([]);
  });
  it("also requires the unchanged existing UNSATISFIED predicate", () => {
    const index = buildPrerequisiteReviewIndex(base(), [edge(2, 1)]);
    for (const status of ["UNKNOWN", "NONE", "SATISFIED"] as const) {
      expect(derivePrerequisiteProgressReview(index, new Set([2]), new Map([[2, status]]))).toEqual([]);
    }
  });
  it("handles a deep synthetic graph without recursive ancestor enumeration", () => {
    const count = 20000;
    const quests = Array.from({ length: count }, (_, i) => quest(i + 1, i ? [i] : [], i + 1 < count ? [i + 2] : []));
    const edges = Array.from({ length: count - 1 }, (_, i) => edge(i + 2, i + 1));
    expect(review(quests, edges, [count]).candidates.map(c => c.successor.id)).toEqual([count]);
  });
});
