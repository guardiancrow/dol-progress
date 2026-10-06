import type { QuestWithDiscoveries } from "../domain/models";
import type { QuestDependency } from "./prerequisites";

export interface DirectPrerequisite {
  id: number;
  name: string;
}

export function resolveDirectPrerequisites(
  quests: readonly QuestWithDiscoveries[],
  dependencies: readonly QuestDependency[],
): Map<number, DirectPrerequisite[]> {
  // The repository supplies Quest rows in source_order NULL-last, source_order, id order.
  const byId = new Map(quests.map(({ quest }, order) => [quest.id, {
    id: quest.id,
    name: quest.title,
    order,
  }]));
  const incoming = new Map<number, Map<number, DirectPrerequisite>>();
  for (const { questId, prerequisiteQuestId } of dependencies) {
    const predecessor = byId.get(prerequisiteQuestId);
    if (!predecessor) continue;
    const direct = incoming.get(questId) ?? new Map<number, DirectPrerequisite>();
    direct.set(predecessor.id, { id: predecessor.id, name: predecessor.name });
    incoming.set(questId, direct);
  }
  return new Map([...incoming].map(([questId, direct]) => [
    questId,
    [...direct.values()].sort((a, b) =>
      byId.get(a.id)!.order - byId.get(b.id)!.order || a.id - b.id),
  ]));
}
