import { matchesOfferMethod } from "./offerMethods";
import type { QuestRowViewModel } from "./types";

export function getMapOfferCities(
  row: Pick<QuestRowViewModel, "offerMethod" | "offerCity" | "offerCities">,
): string | null {
  if (!matchesOfferMethod(row.offerMethod, "group:map")) return null;
  // CSV由来の元文字列を優先し、未取得の場合だけ既存の正規化済み都市を使う。
  const source = row.offerCity === null ? row.offerCities : [row.offerCity];
  const cities = [...new Set(source.flatMap((value) => value.split(","))
    .map((value) => value.trim()).filter((value) => value.length > 0))];
  return cities.length > 0 ? cities.join("、") : null;
}
