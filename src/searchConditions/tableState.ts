import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import type { DiscoveryRowViewModel } from "../discoveries/types";
import { offerCityFilterValue, validOfferCities } from "../quests/offerCityUi";
import { buildOfferMethodOptions, isOfferMethodSelectionAvailable, offerMethodOptionValue } from "../quests/offerMethods";
import { getRequiredSkillRank } from "../quests/requiredSkillRank";
import type { QuestRowViewModel } from "../quests/types";
import {
  blocked, decodeSearchCondition, SEARCH_CONDITION_VERSION,
  type ConditionResult, type DiscoverySearchCondition, type QuestSearchCondition, type SearchConditionDefinition,
} from "./definition";

export const RANK_COLUMN_ID = "selectedRequiredSkillRank";
export const DISCOVERY_CATEGORY_PREFIX = "category:";

export interface SearchTableState {
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
}

const collator = new Intl.Collator("ja", { numeric: true });

export function questSearchOptions(rows: readonly QuestRowViewModel[]) {
  const categories = new Map<number, { id: number; name: string; sortOrder: number }>();
  for (const row of rows) {
    for (const discovery of row.discoveries) {
      if (discovery.categoryId !== null && discovery.categoryName !== null) {
        categories.set(discovery.categoryId, {
          id: discovery.categoryId,
          name: discovery.categoryName,
          sortOrder: discovery.categorySortOrder ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }
  return {
    rows,
    offerMethods: buildOfferMethodOptions(rows.map(row => row.offerMethod)),
    cities: uniqueValues(rows.flatMap(row => validOfferCities(row.offerCities))),
    skills: uniqueValues(rows.flatMap(row => row.requiredSkillNames)),
    categories: [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  };
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort(collator.compare);
}

export function discoverySearchOptions(rows: readonly DiscoveryRowViewModel[]) {
  const categories = new Map<number, NonNullable<DiscoveryRowViewModel["category"]>>();
  for (const row of rows) if (row.category) categories.set(row.category.id, row.category);
  return {
    categories: [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder || collator.compare(a.name, b.name)),
    hasUncategorized: rows.some(row => row.category === null),
  };
}

export type QuestSearchOptions = ReturnType<typeof questSearchOptions>;
export type DiscoverySearchOptions = ReturnType<typeof discoverySearchOptions>;

function namedCategory(options: DiscoverySearchOptions["categories"], name: string) {
  const matches = options.filter(category => category.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function searchTableState(definition: SearchConditionDefinition, filters: Record<string, unknown>): ConditionResult<SearchTableState> {
  const nameColumn = definition.page === "quests" ? "title" : "name";
  const columnFilters = Object.entries({ [nameColumn]: definition.search || undefined, ...filters })
    .filter(([, value]) => value !== undefined).map(([id, value]) => ({ id, value }));
  const sorting = definition.sorting.map(({ key, direction }) => ({
    id: key === "requiredSkillRank" ? RANK_COLUMN_ID : key,
    desc: direction === "desc",
  }));
  return { status: "ready", value: { columnFilters, sorting } };
}

export function resolveQuestSearch(condition: QuestSearchCondition, options: QuestSearchOptions): ConditionResult<SearchTableState> {
  const { offerMethod, offerCity, discoveries, requiredSkills, ...other } = condition.filters;
  const method = offerMethod?.kind === "named" ? offerMethodOptionValue(offerMethod.name)
    : offerMethod?.kind === "group" ? `group:${offerMethod.value}` : offerMethod?.kind;
  if (method !== undefined && !isOfferMethodSelectionAvailable(method, options.offerMethods)) {
    return blocked("unavailable", "offerMethod", offerMethod?.kind === "named" ? offerMethod.name : method);
  }
  if (offerCity?.kind === "named" && !options.cities.includes(offerCity.name)) return blocked("unavailable", "offerCity", offerCity.name);
  if (requiredSkills !== undefined && !options.skills.includes(requiredSkills)) return blocked("unavailable", "requiredSkills", requiredSkills);
  if (condition.sorting.some(sort => sort.key === "requiredSkillRank") && (requiredSkills === undefined
    || !options.rows.some(row => getRequiredSkillRank(row.requiredSkillsNormalized, requiredSkills) !== null))) {
    return blocked("unavailable", "requiredSkillRank", requiredSkills);
  }

  let discoveryFilter: string | undefined;
  if (typeof discoveries === "object") {
    const category = namedCategory(options.categories, discoveries.name);
    if (!category) return blocked("unavailable", "discoveries", discoveries.name);
    discoveryFilter = `${DISCOVERY_CATEGORY_PREFIX}${category.id}`;
  } else {
    discoveryFilter = discoveries;
  }
  return searchTableState(condition, {
    ...other,
    offerMethod: method,
    offerCity: offerCity?.kind === "named" ? offerCityFilterValue(offerCity.name) : offerCity?.kind,
    requiredSkills, discoveries: discoveryFilter,
  });
}

export function resolveDiscoverySearch(condition: DiscoverySearchCondition, options: DiscoverySearchOptions): ConditionResult<SearchTableState> {
  const { category, ...other } = condition.filters;
  if (category?.kind === "named") {
    const match = namedCategory(options.categories, category.name);
    if (!match) return blocked("unavailable", "category", category.name);
    return searchTableState(condition, { ...other, category: match.id });
  }
  // An explicit unset filter may legitimately have zero matching rows after a refresh.
  return searchTableState(condition, { ...other, category: category?.kind });
}

const named = (name: string) => ({ kind: "named", name });
const unset = { kind: "unset" };

function captureQuestFilter(id: string, value: unknown, options: QuestSearchOptions): unknown {
  if (id === "offerCity") {
    if (value === "unset") return unset;
    const city = options.cities.find(city => offerCityFilterValue(city) === value);
    return city === undefined ? undefined : named(city);
  }
  if (id === "offerMethod") {
    if (value === "unset") return unset;
    if (value === "group:map" || value === "group:quest") return { kind: "group", value: value.slice(6) };
    const { quest, map, other } = options.offerMethods;
    const method = [...quest, ...map, ...other].find(method => offerMethodOptionValue(method) === value);
    return method === undefined ? undefined : named(method);
  }
  if (id === "discoveries" && value !== "has-any" && value !== "has-none") {
    const category = options.categories.find(category => `${DISCOVERY_CATEGORY_PREFIX}${category.id}` === value);
    return category === undefined ? undefined : named(category.name);
  }
  return value;
}

export function captureSearchCondition(
  scope: { page: "quests"; options: QuestSearchOptions } | { page: "discoveries"; options: DiscoverySearchOptions },
  state: SearchTableState,
): ConditionResult<SearchConditionDefinition> {
  const nameColumn = scope.page === "quests" ? "title" : "name";
  let search: unknown = "";
  const entries: [string, unknown][] = [];
  const seen = new Set<string>();
  for (const { id, value } of state.columnFilters) {
    if (seen.has(id)) return blocked("invalid", id);
    seen.add(id);
    if (id === nameColumn) {
      search = value;
    } else if (scope.page === "quests") {
      entries.push([id, captureQuestFilter(id, value, scope.options)]);
    } else if (id === "category") {
      const category = scope.options.categories.find(category => category.id === value);
      entries.push([id, value === "unset" ? unset : category === undefined ? undefined : named(category.name)]);
    } else {
      entries.push([id, value]);
    }
  }
  const decoded = decodeSearchCondition({
    schemaVersion: SEARCH_CONDITION_VERSION, page: scope.page, search, filters: Object.fromEntries(entries),
    sorting: state.sorting.map(({ id, desc }) => ({ key: id === RANK_COLUMN_ID ? "requiredSkillRank" : id, direction: desc ? "desc" : "asc" })),
  });
  if (decoded.status === "blocked") return decoded;
  const resolved = scope.page === "quests" && decoded.value.page === "quests"
    ? resolveQuestSearch(decoded.value, scope.options)
    : scope.page === "discoveries" && decoded.value.page === "discoveries"
      ? resolveDiscoverySearch(decoded.value, scope.options) : blocked("invalid", "page");
  return resolved.status === "blocked" ? resolved : decoded;
}
