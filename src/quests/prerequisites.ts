import type { Quest } from "../domain/models";

export type PrerequisiteStatus = "NONE" | "SATISFIED" | "UNSATISFIED" | "UNKNOWN";

export interface QuestDependency {
  questId: number;
  prerequisiteQuestId: number;
}

type QuestMetadata = Pick<Quest, "id" | "gvdbId" | "offerMethod" | "isActive" | "rawRowJson">;

const ordinaryQuestMethods = new Set(["冒険クエスト", "交易クエスト", "海事クエスト"]);

interface RawRelations {
  prerequisites: Set<number>;
  successors: Set<number>;
  valid: boolean;
}

/** The graph records links, not AND/OR groups or non-Quest completion rules. */
export function derivePrerequisiteStatuses(
  quests: readonly QuestMetadata[],
  dependencies: readonly QuestDependency[],
  completedQuestIds: ReadonlySet<number>,
): Map<number, PrerequisiteStatus> {
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const byGvdbId = new Map(quests.map((quest) => [quest.gvdbId, quest]));
  const rawById = new Map(quests.map((quest) => [quest.id, parseRawRelations(quest.rawRowJson)]));
  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();
  const edgeKeys = new Set<string>();
  const anomalous = new Set<number>();

  for (const quest of quests) {
    if (!rawById.get(quest.id)?.valid) anomalous.add(quest.id);
  }

  for (const edge of dependencies) {
    const key = `${edge.questId}:${edge.prerequisiteQuestId}`;
    if (edgeKeys.has(key)) anomalous.add(edge.questId);
    edgeKeys.add(key);
    const prerequisites = incoming.get(edge.questId) ?? [];
    prerequisites.push(edge.prerequisiteQuestId);
    incoming.set(edge.questId, prerequisites);
    const successors = outgoing.get(edge.prerequisiteQuestId) ?? [];
    successors.push(edge.questId);
    outgoing.set(edge.prerequisiteQuestId, successors);

    const dependent = byId.get(edge.questId);
    const predecessor = byId.get(edge.prerequisiteQuestId);
    if (!dependent || !predecessor || dependent.id === predecessor.id) {
      anomalous.add(edge.questId);
      continue;
    }
    if (
      !rawById.get(dependent.id)?.prerequisites.has(predecessor.gvdbId) ||
      !rawById.get(predecessor.id)?.successors.has(dependent.gvdbId)
    ) {
      anomalous.add(dependent.id);
    }
  }

  for (const quest of quests) {
    const raw = rawById.get(quest.id);
    if (!raw) continue;
    for (const prerequisiteGvdbId of raw.prerequisites) {
      const predecessor = byGvdbId.get(prerequisiteGvdbId);
      if (!predecessor || !edgeKeys.has(`${quest.id}:${predecessor.id}`)) {
        anomalous.add(quest.id);
      }
    }
    for (const successorGvdbId of raw.successors) {
      const successor = byGvdbId.get(successorGvdbId);
      if (successor && !edgeKeys.has(`${successor.id}:${quest.id}`)) {
        anomalous.add(successor.id);
      }
    }
  }

  // Kahn's algorithm bounds cycle detection even when a future import is malformed.
  const inDegree = new Map(quests.map((quest) => [quest.id, incoming.get(quest.id)?.length ?? 0]));
  const queue = quests.filter((quest) => inDegree.get(quest.id) === 0).map((quest) => quest.id);
  for (let index = 0; index < queue.length; index += 1) {
    for (const successorId of outgoing.get(queue[index]!) ?? []) {
      const remaining = (inDegree.get(successorId) ?? 0) - 1;
      inDegree.set(successorId, remaining);
      if (remaining === 0) queue.push(successorId);
    }
  }
  for (const [questId, degree] of inDegree) {
    if (degree > 0) anomalous.add(questId);
  }

  const statuses = new Map<number, PrerequisiteStatus>();
  for (const quest of quests) {
    const predecessorIds = incoming.get(quest.id) ?? [];
    if (anomalous.has(quest.id)) {
      statuses.set(quest.id, "UNKNOWN");
    } else if (predecessorIds.length === 0) {
      statuses.set(quest.id, "NONE");
    } else if (
      !quest.isActive ||
      predecessorIds.some((id) => {
        const predecessor = byId.get(id);
        return !predecessor?.isActive || !ordinaryQuestMethods.has(predecessor.offerMethod ?? "");
      })
    ) {
      statuses.set(quest.id, "UNKNOWN");
    } else if (predecessorIds.length === 1) {
      statuses.set(quest.id, completedQuestIds.has(predecessorIds[0]!) ? "SATISFIED" : "UNSATISFIED");
    } else {
      statuses.set(
        quest.id,
        predecessorIds.every((id) => completedQuestIds.has(id)) ? "SATISFIED" : "UNKNOWN",
      );
    }
  }
  return statuses;
}

function parseRawRelations(rawRowJson: string): RawRelations {
  try {
    const raw: unknown = JSON.parse(rawRowJson);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Invalid row");
    const fields = raw as Record<string, unknown>;
    const prerequisites = parseReferenceIds(fields["前提クエスト"]);
    const successors = parseReferenceIds(fields["後続クエスト"]);
    return { prerequisites, successors, valid: true };
  } catch {
    return { prerequisites: new Set(), successors: new Set(), valid: false };
  }
}

function parseReferenceIds(value: unknown): Set<number> {
  if (value === undefined || value === "") return new Set();
  if (typeof value !== "string") throw new Error("Invalid relation field");
  const ids = new Set<number>();
  for (const reference of value.split(",")) {
    const separator = reference.indexOf(":");
    const textId = reference.slice(0, separator).trim();
    if (separator < 0 || !/^[1-9]\d*$/.test(textId)) throw new Error("Invalid relation");
    const id = Number(textId);
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error("Invalid relation ID");
    ids.add(id);
  }
  return ids;
}
