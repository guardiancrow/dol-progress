import { describe, expect, it } from "vitest";
import { deriveSuccessorStatuses } from "./successorStatuses";

function quest(id: number, prerequisites: unknown = "", successors: unknown = "", isActive = true) {
  return {
    id,
    gvdbId: id + 1000,
    isActive,
    rawRowJson: JSON.stringify({ 前提クエスト: prerequisites, 後続クエスト: successors }),
  };
}

function edge(predecessorId: number, successorId: number) {
  return { questId: successorId, prerequisiteQuestId: predecessorId };
}

describe("deriveSuccessorStatuses", () => {
  it("uses direct edges and accepts either direction of source evidence by GVDB ID", () => {
    const quests = [quest(1, "", "1002:旧名"), quest(2), quest(3, "1002:中間,1004:別の前提"), quest(4)];

    expect(deriveSuccessorStatuses(quests, [edge(1, 2), edge(2, 3), edge(4, 3)])).toEqual(new Map([
      [1, "present"], [2, "present"], [3, "absent"], [4, "present"],
    ]));
    expect(deriveSuccessorStatuses([quests[0]!, quests[2]!, quests[3]!], [edge(4, 3)]).get(1)).toBe("unknown");
  });

  it("reads import-compatible blank, duplicate, signed and zero-padded relationship fields", () => {
    const quests = [quest(1, "\u0085　", " +001002 :旧名:補足,1002:重複"), quest(2, "　")];
    expect(deriveSuccessorStatuses(quests, [edge(1, 2)])).toEqual(new Map([[1, "present"], [2, "absent"]]));
  });

  it("tracks missing and mismatched outgoing edges at their predecessor", () => {
    const quests = [quest(1, "", "1999:欠損"), quest(2), quest(3), quest(4, "1003:前提"), quest(5), quest(6)];
    expect(deriveSuccessorStatuses(quests, [edge(2, 99), edge(5, 6)])).toEqual(new Map([
      [1, "unknown"], [2, "unknown"], [3, "unknown"], [4, "absent"], [5, "unknown"], [6, "absent"],
    ]));
  });

  it("does not use a verified descendant to confirm an unresolved direct edge", () => {
    const quests = [quest(1), quest(2, "", "1003:第三"), quest(3, "1002:第二")];
    expect(deriveSuccessorStatuses(quests, [edge(1, 2), edge(2, 3)])).toEqual(new Map([
      [1, "unknown"], [2, "present"], [3, "absent"],
    ]));
  });

  it("distinguishes archived-only relations from current references to inactive masters", () => {
    const quests = [
      quest(1), quest(2, "1001:第一", "1003:第三", false), quest(3),
      quest(4, "", "1005:旧依頼"), quest(5, "1004:第四", "", false),
      quest(6), quest(7, "", "", false),
    ];
    expect(deriveSuccessorStatuses(quests, [edge(1, 2), edge(2, 3), edge(4, 5), edge(6, 7)])).toEqual(new Map([
      [1, "absent"], [2, "unknown"], [3, "absent"], [4, "unknown"], [5, "unknown"], [6, "unknown"], [7, "unknown"],
    ]));
  });

  it("limits an unreadable successor field to its row and lets independent evidence take priority", () => {
    const missing = { ...quest(1), rawRowJson: '{"前提クエスト":""}' };
    const quests = [missing, quest(2, "", null), quest(3), quest(4, "1001:第一")];
    expect(deriveSuccessorStatuses(quests, [edge(1, 4)])).toEqual(new Map([
      [1, "present"], [2, "unknown"], [3, "absent"], [4, "absent"],
    ]));
    expect(deriveSuccessorStatuses(quests.slice(0, 3), []).get(1)).toBe("unknown");
  });

  it.each(['{"後続クエスト":""}', '{"前提クエスト":"不正","後続クエスト":""}', "[", "[]",
    '{"前提クエスト":"9007199254740993:範囲外","後続クエスト":""}'])(
    "requires readable current prerequisite fields to establish absence (%s)", (rawRowJson) => {
      const unreadable = { ...quest(4), rawRowJson };
      const quests = [quest(1, "", "1004:第四"), quest(2), quest(3), unreadable];
      expect(deriveSuccessorStatuses(quests, [edge(1, 4)])).toEqual(new Map([
        [1, "present"], [2, "unknown"], [3, "unknown"], [4, "unknown"],
      ]));
      expect(deriveSuccessorStatuses([quest(2), { ...unreadable, isActive: false }], []).get(2)).toBe("absent");
    },
  );

  it("prefers an independently confirmed successor over missing, duplicate and unnormalized branches", () => {
    const quests = [quest(1, "", "1999:欠損,1002:正常,1003:重複,1004:原文のみ"), quest(2), quest(3), quest(4)];
    expect(deriveSuccessorStatuses(quests, [edge(1, 3), edge(1, 2), edge(1, 3)]).get(1)).toBe("present");
    expect(deriveSuccessorStatuses(quests, [edge(1, 3), edge(1, 3)]).get(1)).toBe("unknown");
  });

  it("requires uniquely identifiable endpoints", () => {
    const quests = [quest(1, "", "1002:候補"), quest(2), { ...quest(3), gvdbId: 1002 }, quest(4)];
    expect(deriveSuccessorStatuses(quests, [edge(1, 2)])).toEqual(new Map([
      [1, "unknown"], [2, "unknown"], [3, "unknown"], [4, "absent"],
    ]));
  });

  it("isolates cycle edges and keeps independently supported edges into or out of a cycle", () => {
    const quests = [
      quest(1, "", "1002:第二"), quest(2, "", "1001:第一,1003:第三"), quest(3, "", "1004:第四"),
      quest(4), quest(5, "", "1001:第一"), quest(6), quest(7, "", "1007:自己"),
    ];
    const dependencies = [edge(2, 3), edge(5, 1), edge(3, 4), edge(2, 1), edge(1, 2)];
    const expected = new Map([
      [1, "unknown"], [2, "present"], [3, "present"], [4, "absent"], [5, "present"], [6, "absent"], [7, "unknown"],
    ]);
    expect(deriveSuccessorStatuses(quests, dependencies)).toEqual(expected);
    expect(deriveSuccessorStatuses([...quests].reverse(), [...dependencies].reverse())).toEqual(expected);
  });

  it("handles a 30,000-quest chain without recursion", () => {
    const size = 30_000;
    const quests = Array.from({ length: size }, (_, i) => quest(i + 1, i === 0 ? "" : `${i + 1000}:前提`));
    const dependencies = Array.from({ length: size - 1 }, (_, i) => edge(i + 1, i + 2));

    const statuses = deriveSuccessorStatuses(quests, dependencies);

    expect(statuses.size).toBe(size);
    expect([...statuses.values()].filter(status => status === "present")).toHaveLength(size - 1);
    expect(statuses.get(size)).toBe("absent");
  });
});
