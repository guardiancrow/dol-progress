import type { Quest } from "../domain/models";
import type { QuestDependency } from "./prerequisites";

export type SuccessorStatus = "present" | "absent" | "unknown";

type MasterQuest = Pick<Quest, "id" | "gvdbId" | "isActive" | "rawRowJson">;

interface ReferenceField {
  state: "read" | "missing" | "invalid";
  ids: ReadonlySet<number>;
}

const EMPTY_IDS = new Set<number>();

export function deriveSuccessorStatuses(
  quests: readonly MasterQuest[],
  dependencies: readonly QuestDependency[],
): Map<number, SuccessorStatus> {
  const byId = indexUniqueQuests(quests, "id");
  const byGvdbId = indexUniqueQuests(quests, "gvdbId");
  const isIdentified = (quest: MasterQuest) => byId.get(quest.id) === quest && byGvdbId.get(quest.gvdbId) === quest;
  const raw = new Map(quests.map(quest => [quest, parseRelations(quest.rawRowJson)]));
  const unresolved = new Set<number>();
  let allCurrentPrerequisitesRead = true;

  // Index canonical edges by predecessor. Mark duplicate edges independently of their siblings.
  const canonical = new Map<number, Map<number, boolean>>();
  for (const { questId, prerequisiteQuestId } of dependencies) {
    const successors = canonical.get(prerequisiteQuestId) ?? new Map<number, boolean>();
    successors.set(questId, !successors.has(questId));
    canonical.set(prerequisiteQuestId, successors);
  }

  for (const [quest, { prerequisites, successors }] of raw) {
    if (!quest.isActive) continue;
    if (prerequisites.state !== "read") allCurrentPrerequisitesRead = false;
    if (successors.state !== "read") unresolved.add(quest.id);

    for (const gvdbId of prerequisites.ids) {
      const predecessor = byGvdbId.get(gvdbId);
      if (predecessor?.isActive && (!isIdentified(quest) || !canonical.get(predecessor.id)?.has(quest.id))) {
        unresolved.add(predecessor.id);
      }
    }
    for (const gvdbId of successors.ids) {
      const successor = byGvdbId.get(gvdbId);
      if (!successor?.isActive || !isIdentified(successor) || !canonical.get(quest.id)?.has(successor.id)) {
        unresolved.add(quest.id);
      }
    }
  }

  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  const supportedEdges: Array<{ predecessorId: number; successorId: number }> = [];
  for (const [predecessorId, successors] of canonical) {
    const predecessor = byId.get(predecessorId);
    if (!predecessor?.isActive || !isIdentified(predecessor)) continue;
    for (const [successorId, unique] of successors) {
      const successor = byId.get(successorId);
      if (!successor || !isIdentified(successor) || successorId === predecessorId) {
        unresolved.add(predecessorId);
        continue;
      }

      const fromPredecessor = raw.get(predecessor)!.successors.ids.has(successor.gvdbId);
      const fromSuccessor = raw.get(successor)!.prerequisites.ids.has(predecessor.gvdbId);
      if (!successor.isActive) {
        // A relation explained solely by the archived successor's row is historical.
        if (!unique || fromPredecessor || !fromSuccessor) unresolved.add(predecessorId);
        continue;
      }

      const next = outgoing.get(predecessorId) ?? [];
      next.push(successorId);
      outgoing.set(predecessorId, next);
      const previous = incoming.get(successorId) ?? [];
      previous.push(predecessorId);
      incoming.set(successorId, previous);

      if (unique && (fromPredecessor || fromSuccessor)) {
        supportedEdges.push({ predecessorId, successorId });
      } else {
        unresolved.add(predecessorId);
      }
    }
  }

  const components = findStronglyConnectedComponents(outgoing, incoming);
  const confirmed = new Set<number>();
  for (const { predecessorId, successorId } of supportedEdges) {
    if (components.get(predecessorId) === components.get(successorId)) {
      unresolved.add(predecessorId);
    } else {
      confirmed.add(predecessorId);
    }
  }

  const statuses = new Map<number, SuccessorStatus>();
  for (const quest of quests) {
    let status: SuccessorStatus = "unknown";
    if (quest.isActive && isIdentified(quest)) {
      if (confirmed.has(quest.id)) status = "present";
      else if (allCurrentPrerequisitesRead && !unresolved.has(quest.id)) status = "absent";
    }
    statuses.set(quest.id, status);
  }
  return statuses;
}

function indexUniqueQuests(quests: readonly MasterQuest[], key: "id" | "gvdbId") {
  const index = new Map<number, MasterQuest | null>();
  for (const quest of quests) {
    const id = quest[key];
    if (Number.isSafeInteger(id) && id > 0) index.set(id, index.has(id) ? null : quest);
  }
  return index;
}

function parseRelations(rawRowJson: string) {
  let row: unknown;
  try {
    row = JSON.parse(rawRowJson);
  } catch {
    row = null;
  }
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    const invalid: ReferenceField = { state: "invalid", ids: EMPTY_IDS };
    return { prerequisites: invalid, successors: invalid };
  }
  const fields = row as Record<string, unknown>;
  return {
    prerequisites: parseReferences(fields["前提クエスト"]),
    successors: parseReferences(fields["後続クエスト"]),
  };
}

function parseReferences(value: unknown): ReferenceField {
  if (value === undefined) return { state: "missing", ids: EMPTY_IDS };
  if (typeof value !== "string") return { state: "invalid", ids: EMPTY_IDS };
  if (trimSourceWhitespace(value) === "") return { state: "read", ids: EMPTY_IDS };

  const ids = new Set<number>();
  for (const reference of value.split(",")) {
    const separator = reference.indexOf(":");
    const text = trimSourceWhitespace(reference.slice(0, separator));
    const id = Number(text);
    // Match the import's positive integer syntax and deduplication within JS's exact ID range.
    if (separator < 0 || !/^\+?\d+$/.test(text) || !Number.isSafeInteger(id) || id <= 0) {
      return { state: "invalid", ids: EMPTY_IDS };
    }
    ids.add(id);
  }
  return { state: "read", ids };
}

function trimSourceWhitespace(value: string) {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

function findStronglyConnectedComponents(
  outgoing: ReadonlyMap<number, readonly number[]>,
  incoming: ReadonlyMap<number, readonly number[]>,
) {
  // Iterative Kosaraju avoids recursion on long chains and isolates actual cycle edges.
  const finished: number[] = [];
  const visited = new Set<number>();
  for (const id of outgoing.keys()) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, nextIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = outgoing.get(frame.id)?.[frame.nextIndex];
      if (next === undefined) {
        finished.push(frame.id);
        stack.pop();
      } else {
        frame.nextIndex += 1;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, nextIndex: 0 });
        }
      }
    }
  }

  const components = new Map<number, number>();
  for (let i = finished.length - 1; i >= 0; i -= 1) {
    const root = finished[i]!;
    if (components.has(root)) continue;
    components.set(root, root);
    const stack = [root];
    while (stack.length > 0) {
      for (const previous of incoming.get(stack.pop()!) ?? []) {
        if (components.has(previous)) continue;
        components.set(previous, root);
        stack.push(previous);
      }
    }
  }
  return components;
}
