const QUEST_OFFER_METHODS: ReadonlySet<string> = new Set([
  "冒険クエスト",
  "交易クエスト",
  "海事クエスト",
]);

const MAP_OFFER_METHODS: ReadonlySet<string> = new Set([
  "地理学",
  "考古学",
  "宗教学",
  "生物学",
  "美術",
  "財宝鑑定",
  "天文学",
]);

const METHOD_PREFIX = "method:";
const collator = new Intl.Collator("ja", { numeric: true });

export interface OfferMethodOptions {
  quest: string[];
  map: string[];
  other: string[];
  hasUnset: boolean;
}

export function buildOfferMethodOptions(values: readonly (string | null)[]): OfferMethodOptions {
  const methods = [...new Set(values.filter((value): value is string => value !== null))]
    .sort((left, right) => collator.compare(left, right));
  return {
    quest: methods.filter((method) => QUEST_OFFER_METHODS.has(method)),
    map: methods.filter((method) => MAP_OFFER_METHODS.has(method)),
    other: methods.filter((method) =>
      !QUEST_OFFER_METHODS.has(method) && !MAP_OFFER_METHODS.has(method)),
    hasUnset: values.includes(null),
  };
}

export function offerMethodOptionValue(method: string): string {
  return `${METHOD_PREFIX}${method}`;
}

export function matchesOfferMethod(method: string | null, value: unknown): boolean {
  if (value === undefined || value === "all") return true;
  if (value === "unset") return method === null;
  if (value === "group:quest") return method !== null && QUEST_OFFER_METHODS.has(method);
  if (value === "group:map") return method !== null && MAP_OFFER_METHODS.has(method);
  if (typeof value === "string" && value.startsWith(METHOD_PREFIX)) {
    return method === value.slice(METHOD_PREFIX.length);
  }
  return false;
}

export function isOfferMethodSelectionAvailable(value: string, options: OfferMethodOptions): boolean {
  if (value === "all") return true;
  if (value === "unset") return options.hasUnset;
  if (value === "group:quest") return options.quest.length > 0;
  if (value === "group:map") return options.map.length > 0;
  if (value.startsWith(METHOD_PREFIX)) {
    const method = value.slice(METHOD_PREFIX.length);
    return [...options.quest, ...options.map, ...options.other].includes(method);
  }
  return false;
}
