import { describe, expect, it } from "vitest";
import type { QuestWithDiscoveries } from "../domain/models";
import { buildPrerequisiteDetailsData } from "./prerequisiteDetails";
import { resolveDirectPrerequisites } from "./directPrerequisites";
import { buildPrerequisiteReviewIndex, derivePrerequisiteProgressReview } from "./prerequisiteProgressReview";
import { derivePrerequisiteStatuses } from "./prerequisites";

function fixture() {
  const masters: QuestWithDiscoveries[] = [1, 2, 3].map(id => ({ quest: {
    id, gvdbId: 1000 + id, title: `依頼${id}`, offerMethod: "冒険クエスト", isActive: true,
    rawRowJson: JSON.stringify({ 前提クエスト: id > 1 ? `${999 + id}:合成` : "", 後続クエスト: id < 3 ? `${1001 + id}:合成` : "" }),
    difficulty: null, chronoQuest: null, offerCity: null, requiredSkills: null, discoveryTypeText: null, rewardItems: null,
    notes: "未開示の備考", chainName: null, chainOrder: null, sourceUpdatedAt: null, createdAt: "synthetic", updatedAt: "synthetic",
  }, discoveries: [], requiredSkillsNormalized: [], offerCities: [] }));
  const dependencies = [{ questId: 2, prerequisiteQuestId: 1 }, { questId: 3, prerequisiteQuestId: 2 }];
  const build = (diagnosed = true) => buildPrerequisiteDetailsData(masters, dependencies,
    resolveDirectPrerequisites(masters, dependencies), diagnosed ? buildPrerequisiteReviewIndex(masters.map(m => m.quest), dependencies) : undefined);
  return { masters, dependencies, build };
}
describe("canonical prerequisite detail data", () => {
  it("keeps direct names independent of candidate eligibility and omits raw data and notes from display identities", () => {
    const f = fixture(), data = f.build();
    expect(data.direct.get(1)).toBeUndefined(); expect(data.direct.get(3)).toEqual([{ id: 2, name: "依頼2" }]);
    expect(data.quests.get(2)).toEqual({ id: 2, gvdbId: 1002, title: "依頼2" });
    expect(JSON.stringify([...data.quests.values()])).not.toContain("未開示");
    expect(data.reasons.get(3)).toEqual([]);
  });
  it("never fills a canonical blank cell from raw-only references", () => {
    const f = fixture(); f.dependencies.splice(0);
    const data = f.build(); expect(data.direct.size).toBe(0);
    expect(data.reasons.get(2)?.join()).toMatch(/参照先|整合性/);
  });
  it("reports multiple and missing direct prerequisites without deriving AND/OR or creating records", () => {
    const f = fixture(); f.dependencies.push({ questId: 3, prerequisiteQuestId: 99 });
    const data = f.build(); expect(data.direct.get(3)).toHaveLength(1);
    expect(data.quests.has(99)).toBe(false);
    expect(data.reasons.get(3)?.join()).toMatch(/AND\/OR/);
    expect(data.reasons.get(3)?.join()).toMatch(/マスターが欠損/);
  });
  it("reports unavailable diagnostics as unconfirmed instead of inventing a structural reason", () => {
    const f = fixture(), data = f.build(false);
    expect(data.reasons.get(2)).toEqual(["構造診断の結果を確認できません。"]);
  });
  it("uses generic structural reasons without disclosing names or IDs from subsequent references", () => {
    const f = fixture(); f.masters[2]!.quest.rawRowJson = JSON.stringify({ 後続クエスト: "998877:未開示の後継名" });
    const reason = f.build().reasons.get(3)!.join();
    expect(reason).toMatch(/参照先|整合性/); expect(reason).not.toMatch(/998877|未開示|後継/);
  });
  it("keeps same-name IDs separate and special/inactive relations readable without granting permission", () => {
    const f = fixture(); f.masters[0]!.quest.title = f.masters[1]!.quest.title = "同名";
    f.masters[0]!.quest.offerMethod = "地理学"; f.masters[1]!.quest.isActive = false;
    const data = f.build(), index = buildPrerequisiteReviewIndex(f.masters.map(m => m.quest), f.dependencies);
    expect(data.direct.get(3)).toEqual([{ id: 2, name: "同名" }]);
    expect(data.quests.get(1)?.gvdbId).not.toBe(data.quests.get(2)?.gvdbId);
    expect(data.reasons.get(1)?.join()).toMatch(/特殊/); expect(data.reasons.get(2)?.join()).toMatch(/inactive/);
    expect(derivePrerequisiteProgressReview(index, new Set([3]), derivePrerequisiteStatuses(f.masters.map(m => m.quest), f.dependencies, new Set([3])))).toEqual([]);
  });
  it("keeps duplicate, self and cyclic relations readable but excluded from the unchanged review candidate logic", () => {
    const f = fixture(); f.dependencies.push({ questId: 1, prerequisiteQuestId: 3 }, { questId: 3, prerequisiteQuestId: 3 }, f.dependencies[0]!);
    const data = f.build(), index = buildPrerequisiteReviewIndex(f.masters.map(m => m.quest), f.dependencies);
    expect(data.direct.get(2)).toHaveLength(1); expect(data.reasons.get(2)?.join()).toMatch(/重複|循環/);
    expect(data.reasons.get(3)?.join()).toMatch(/自己参照/); expect(index.pairs).toEqual([]);
  });
  it("builds canonical display and diagnosis for a deep 30,000-record series without recursive ancestor enumeration", () => {
    const base = fixture().masters[0]!;
    const masters = Array.from({ length: 30_000 }, (_, i) => ({ ...base, quest: { ...base.quest, id: i + 1, gvdbId: i + 1,
      rawRowJson: JSON.stringify({ 前提クエスト: i ? `${i}:合成` : "", 後続クエスト: i < 29_999 ? `${i + 2}:合成` : "" }) } }));
    const dependencies = masters.slice(1).map(({ quest }) => ({ questId: quest.id, prerequisiteQuestId: quest.id - 1 }));
    const data = buildPrerequisiteDetailsData(masters, dependencies, resolveDirectPrerequisites(masters, dependencies), buildPrerequisiteReviewIndex(masters.map(m => m.quest), dependencies));
    expect(data.direct.get(30_000)).toEqual([{ id: 29_999, name: base.quest.title }]);
    expect(data.reasons.get(30_000)).toEqual([]);
  });
});
