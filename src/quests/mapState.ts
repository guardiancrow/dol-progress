import type { QuestRowViewModel } from "./types";
import { matchesOfferMethod } from "./offerMethods";
import { currentState, type DiscoveryStateSummary } from "../discoveries/stateReader";

export function mapStatus(row: QuestRowViewModel, states: ReadonlyMap<number, DiscoveryStateSummary>): string {
  if (row.mapActive === false || !matchesOfferMethod(row.offerMethod,"group:map") || !row.discoveries.length) return "unavailable";
  const related = row.discoveries.map(d => states.get(d.id));
  if (related.some(s => !s)) return "review";
  const active = related.filter((s): s is DiscoveryStateSummary => Boolean(s?.active));
  if (!active.length) return "unavailable";
  if (active.some(s => s.categoryName === "レリック")) return "review";
  const values = new Set(active.map(currentState));
  return values.size > 1 ? "mixed" : row.discoveries.length > 1 ? "review" : currentState(active[0]!);
}
