import { describe, expect, it } from "vitest";
import { getMapOfferCities } from "./mapOfferCities";

describe("map offer cities for display", () => {
  it.each([
    ["リスボン", "リスボン"],
    ["リスボン,セビリア,ロンドン", "リスボン、セビリア、ロンドン"],
    ["　リスボン , セビリア\t, ,リスボン,,ロンドン,", "リスボン、セビリア、ロンドン"],
    ["", null],
    ["　, \t,,", null],
  ])("formats the CSV value %j without changing the source", (offerCity, expected) => {
    const row = { offerMethod: "地理学", offerCity, offerCities: ["元文字列と異なる合成値"] };
    const before = structuredClone(row);
    expect(getMapOfferCities(row)).toBe(expected);
    expect(row).toEqual(before);
  });

  it("uses already loaded facets when the raw value is unavailable", () => {
    const row = { offerMethod: "美術", offerCity: null, offerCities: [" ロンドン ", "", "セビリア", "ロンドン"] };
    expect(getMapOfferCities(row)).toBe("ロンドン、セビリア");
    expect(row.offerCities).toEqual([" ロンドン ", "", "セビリア", "ロンドン"]);
    expect(getMapOfferCities({ ...row, offerCities: [] })).toBeNull();
  });

  it.each(["地理学", "考古学", "宗教学", "生物学", "美術", "財宝鑑定", "天文学"])(
    "uses the existing map classification for %s", (offerMethod) => {
      expect(getMapOfferCities({ offerMethod, offerCity: "合成都市", offerCities: [] })).toBe("合成都市");
    },
  );

  it.each(["冒険クエスト", "交易クエスト", "海事クエスト", "トレジャーハント", "未知の分類", null])(
    "does not add map information for %s", (offerMethod) => {
      expect(getMapOfferCities({ offerMethod, offerCity: "合成都市", offerCities: ["合成都市"] })).toBeNull();
    },
  );
});
