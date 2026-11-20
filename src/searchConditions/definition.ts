export const SEARCH_CONDITION_VERSION = 1;

const prerequisiteValues = ["satisfied", "unsatisfied", "unknown", "none"] as const;
const successorValues = ["present", "absent", "unknown"] as const;
const questMapValues = ["candidate", "suppressed"] as const;
const discoveryStatusValues = ["undiscovered", "unreported", "reported"] as const;
const unreportedValues = ["not_reported", "confirmed", "unknown"] as const;
const discoveryMapValues = ["related", "unrelated", "candidate", "suppressed", "review"] as const;
const questSortKeys = ["completed", "title", "difficulty", "offerMethod", "offerCity", "requiredSkillRank"] as const;
const discoverySortKeys = ["status", "name", "cardOwned", "category", "rank", "era", "points", "difficulty", "experience"] as const;

type NamedValue = { kind: "named"; name: string };
type UnsetValue = { kind: "unset" };
type OfferGroup = { kind: "group"; value: "quest" | "map" };
type RelatedDiscovery = "has-any" | "has-none" | NamedValue;

export interface QuestSearchFilters {
  completed?: boolean;
  prerequisiteStatus?: (typeof prerequisiteValues)[number];
  successorStatus?: (typeof successorValues)[number];
  offerMethod?: NamedValue | UnsetValue | OfferGroup;
  offerCity?: NamedValue | UnsetValue;
  requiredSkills?: string;
  discoveries?: RelatedDiscovery;
  mapState?: (typeof questMapValues)[number];
  progressReview?: true;
}

export interface DiscoverySearchFilters {
  category?: NamedValue | UnsetValue;
  status?: (typeof discoveryStatusValues)[number];
  unreportedBreakdown?: (typeof unreportedValues)[number];
  cardOwned?: boolean;
  mapReacquisition?: (typeof discoveryMapValues)[number];
}

interface SortRule<Key extends string> {
  key: Key;
  direction: "asc" | "desc";
}

interface SearchCondition<Page extends string, Filters, SortKey extends string> {
  schemaVersion: typeof SEARCH_CONDITION_VERSION;
  page: Page;
  search: string;
  filters: Filters;
  sorting: readonly SortRule<SortKey>[];
}

export type QuestSearchCondition = SearchCondition<"quests", QuestSearchFilters, (typeof questSortKeys)[number]>;
export type DiscoverySearchCondition = SearchCondition<"discoveries", DiscoverySearchFilters, (typeof discoverySortKeys)[number]>;
export type SearchConditionDefinition = QuestSearchCondition | DiscoverySearchCondition;

export type SearchConditionIssue = {
  kind: "invalid" | "unsupported-version" | "unavailable" | "read-failed";
  field: string;
  value?: string;
};

export type ConditionResult<T> = { status: "ready"; value: T } | { status: "blocked"; issue: SearchConditionIssue };

export function blocked(kind: SearchConditionIssue["kind"], field: string, value?: string): ConditionResult<never> {
  return { status: "blocked", issue: { kind, field, ...(value === undefined ? {} : { value }) } };
}

const isBoolean = (value: unknown) => typeof value === "boolean";
const isName = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const includes = (values: readonly string[], value: unknown) => typeof value === "string" && values.includes(value);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isNamed(value: unknown): value is NamedValue {
  return isObject(value) && Object.keys(value).length === 2 && value.kind === "named" && isName(value.name);
}

function isUnset(value: unknown): value is UnsetValue {
  return isObject(value) && Object.keys(value).length === 1 && value.kind === "unset";
}

function isGroup(value: unknown): value is OfferGroup {
  return isObject(value) && Object.keys(value).length === 2 && value.kind === "group"
    && (value.value === "quest" || value.value === "map");
}

const questFilterChecks = {
  completed: isBoolean,
  prerequisiteStatus: (value) => includes(prerequisiteValues, value),
  successorStatus: (value) => includes(successorValues, value),
  offerMethod: (value) => isNamed(value) || isUnset(value) || isGroup(value),
  offerCity: (value) => isNamed(value) || isUnset(value),
  requiredSkills: isName,
  discoveries: (value) => value === "has-any" || value === "has-none" || isNamed(value),
  mapState: (value) => includes(questMapValues, value),
  progressReview: (value) => value === true,
} satisfies Record<keyof QuestSearchFilters, (value: unknown) => boolean>;

const discoveryFilterChecks = {
  category: (value) => isNamed(value) || isUnset(value),
  status: (value) => includes(discoveryStatusValues, value),
  unreportedBreakdown: (value) => includes(unreportedValues, value),
  cardOwned: isBoolean,
  mapReacquisition: (value) => includes(discoveryMapValues, value),
} satisfies Record<keyof DiscoverySearchFilters, (value: unknown) => boolean>;

const definitionKeys = ["schemaVersion", "page", "search", "filters", "sorting"];

export function decodeSearchCondition(input: unknown): ConditionResult<SearchConditionDefinition> {
  if (!isObject(input)) return blocked("invalid", "definition");
  if (typeof input.schemaVersion !== "number" || !Number.isSafeInteger(input.schemaVersion)) {
    return blocked("invalid", "schemaVersion");
  }
  if (input.schemaVersion !== SEARCH_CONDITION_VERSION) return blocked("unsupported-version", "schemaVersion", String(input.schemaVersion));
  if (input.page !== "quests" && input.page !== "discoveries") return blocked("invalid", "page");
  const unknownKey = Object.keys(input).find(key => !definitionKeys.includes(key));
  if (unknownKey !== undefined) return blocked("invalid", unknownKey);
  if (typeof input.search !== "string") return blocked("invalid", "search");
  if (!isObject(input.filters)) return blocked("invalid", "filters");
  const checks: Record<string, (value: unknown) => boolean> = input.page === "quests" ? questFilterChecks : discoveryFilterChecks;
  for (const [key, value] of Object.entries(input.filters)) {
    if (!Object.prototype.hasOwnProperty.call(checks, key) || !checks[key]!(value)) return blocked("invalid", key);
  }

  if (!Array.isArray(input.sorting)) return blocked("invalid", "sorting");
  const sortKeys = input.page === "quests" ? questSortKeys : discoverySortKeys;
  const seen = new Set<string>();
  for (const sort of input.sorting as unknown[]) {
    if (!isObject(sort) || Object.keys(sort).length !== 2 || typeof sort.key !== "string"
      || !includes(sortKeys, sort.key) || (sort.direction !== "asc" && sort.direction !== "desc") || seen.has(sort.key)) {
      return blocked("invalid", "sorting");
    }
    seen.add(sort.key);
  }
  if (seen.has("requiredSkillRank") && (seen.size !== 1 || !isName(input.filters.requiredSkills))) {
    return blocked("invalid", "requiredSkillRank");
  }

  // The page, filter keys and their values, and all sort entries passed the v1 checks above.
  return { status: "ready", value: structuredClone(input) as unknown as SearchConditionDefinition };
}
