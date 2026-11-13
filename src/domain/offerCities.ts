export function formatOfferCities(values: readonly string[]): string | null {
  const cities = [...new Set(values.flatMap((value) => value.split(","))
    .map((value) => value.trim()).filter((value) => value.length > 0))];
  return cities.length > 0 ? cities.join("、") : null;
}
