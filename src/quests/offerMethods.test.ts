import { describe, expect, it } from "vitest";

import {
  buildOfferMethodOptions,
  isOfferMethodSelectionAvailable,
  matchesOfferMethod,
  offerMethodOptionValue,
} from "./offerMethods";

const questMethods = ["冒険クエスト", "交易クエスト", "海事クエスト"];
const mapMethods = ["地理学", "考古学", "宗教学", "生物学", "美術", "財宝鑑定", "天文学"];
const otherMethods = [
  "トレジャーハント", "レガシー", "伝承クエスト", "勅命クエスト",
  "収奪・陸戦地図", "地図を伴わない天体発見物", "気象・現象（発見物）",
  "沈没船（発見物）", "港・集落（発見物）", "移民誘致クエスト",
  "追究クエスト", "遺跡ダンジョン", "釣り（発見物）", "陸地再調査時の報酬",
];
const collator = new Intl.Collator("ja", { numeric: true });

describe("Quest offer method groups", () => {
  it("matches only exact Quest and map members, never substrings", () => {
    for (const method of questMethods) expect(matchesOfferMethod(method, "group:quest")).toBe(true);
    for (const method of mapMethods) expect(matchesOfferMethod(method, "group:map")).toBe(true);
    for (const method of ["伝承クエスト", "勅命クエスト", "移民誘致クエスト", "追究クエスト"]) {
      expect(matchesOfferMethod(method, "group:quest")).toBe(false);
    }
    for (const method of ["収奪・陸戦地図", "地図を伴わない天体発見物"]) {
      expect(matchesOfferMethod(method, "group:map")).toBe(false);
    }
    expect(matchesOfferMethod("冒険クエスト", offerMethodOptionValue("冒険クエスト"))).toBe(true);
    expect(matchesOfferMethod("交易クエスト", offerMethodOptionValue("冒険クエスト"))).toBe(false);
    expect(matchesOfferMethod("考古学", offerMethodOptionValue("考古学"))).toBe(true);
    expect(matchesOfferMethod("地理学", offerMethodOptionValue("考古学"))).toBe(false);
    expect(matchesOfferMethod(null, "unset")).toBe(true);
    expect(matchesOfferMethod("冒険クエスト", "all")).toBe(true);
  });

  it("derives all individual options from master values, without duplicates or new sorting rules", () => {
    const options = buildOfferMethodOptions([
      ...otherMethods, ...mapMethods, ...questMethods, "冒険クエスト", null,
    ]);
    expect(options.quest).toEqual([...questMethods].sort(collator.compare));
    expect(options.map).toEqual([...mapMethods].sort(collator.compare));
    expect(options.other).toEqual([...otherMethods].sort(collator.compare));
    expect(options.hasUnset).toBe(true);
    expect(options.quest.length + options.map.length + options.other.length).toBe(24);
  });

  it("keeps group definitions while hiding missing members and invalid selections", () => {
    const options = buildOfferMethodOptions(["冒険クエスト", "考古学"]);
    expect(options.quest).toEqual(["冒険クエスト"]);
    expect(options.map).toEqual(["考古学"]);
    expect(isOfferMethodSelectionAvailable("group:quest", options)).toBe(true);
    expect(isOfferMethodSelectionAvailable("method:交易クエスト", options)).toBe(false);
    expect(isOfferMethodSelectionAvailable("method:考古学", options)).toBe(true);
    expect(isOfferMethodSelectionAvailable("unset", options)).toBe(false);
    expect(isOfferMethodSelectionAvailable("group:quest", buildOfferMethodOptions(["考古学"]))).toBe(false);
    expect(isOfferMethodSelectionAvailable("group:map", buildOfferMethodOptions(["冒険クエスト"]))).toBe(false);
  });
});
