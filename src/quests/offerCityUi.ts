import type { QuestRowViewModel } from "./types";

const CITY_PREFIX = "city:";

export function validOfferCities(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(value => value.length > 0))];
}

export function offerCityFilterValue(city: string): string {
  return `${CITY_PREFIX}${city}`;
}

export function matchesOfferCity(cities: readonly string[], value: unknown): boolean {
  if (value === undefined || value === "") return true;
  const valid = validOfferCities(cities);
  if (value === "unset") return valid.length === 0;
  return typeof value === "string" && value.startsWith(CITY_PREFIX)
    && valid.includes(value.slice(CITY_PREFIX.length));
}

export function offerCityDisplay(row: Pick<QuestRowViewModel, "offerCity" | "offerCities">): { text: string; title?: string } {
  const cities = validOfferCities(row.offerCities);
  const sourceCities = validOfferCities(row.offerCity?.split(",") ?? []);
  const consistent = sourceCities.length === cities.length && sourceCities.every(city => cities.includes(city));
  return {
    text: cities.length === 0 ? "—" : consistent ? row.offerCity ?? cities.join("、") : cities.join("、"),
    title: !consistent && sourceCities.length > 0
      ? `登録済みの都市情報を基準に表示・絞り込みます。元の表記：${row.offerCity}`
      : undefined,
  };
}
