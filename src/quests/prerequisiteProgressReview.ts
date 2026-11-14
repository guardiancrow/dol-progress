import type { Quest } from "../domain/models";
import { matchesOfferMethod } from "./offerMethods";
import { parseRawRelations, type PrerequisiteStatus, type QuestDependency } from "./prerequisites";

type ReviewQuest = Pick<Quest, "id" | "gvdbId" | "title" | "offerMethod" | "isActive" | "rawRowJson">;

export interface ReviewQuestIdentity {
  id: number;
  gvdbId: number;
  title: string;
}

export interface PrerequisiteReviewPair {
  successor: ReviewQuestIdentity;
  prerequisite: ReviewQuestIdentity;
}

export interface PrerequisiteProgressCandidate extends PrerequisiteReviewPair {
  successorCompleted: true;
  prerequisiteCompleted: false;
  reason: "single_direct_prerequisite_unrecorded";
}

export type ReviewExclusion = "invalid_id" | "duplicate_id" | "malformed_raw" | "duplicate_edge"
  | "missing_reference" | "relation_mismatch" | "self_reference" | "cycle_or_unresolved" | "affected_ancestor";

export interface PrerequisiteReviewIndex {
  pairs: readonly PrerequisiteReviewPair[];
  excluded: ReadonlyMap<number, ReadonlySet<ReviewExclusion>>;
}

export type PrerequisiteProgressReviewState =
  | { status: "ready"; candidates: readonly PrerequisiteProgressCandidate[] }
  | { status: "loading" | "updating" | "error" };

const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const identity = ({ id, gvdbId, title }: ReviewQuest): ReviewQuestIdentity => ({ id, gvdbId, title });

export function buildPrerequisiteReviewIndex(
  quests: readonly ReviewQuest[], dependencies: readonly QuestDependency[],
): PrerequisiteReviewIndex {
  const byId = new Map<number, ReviewQuest>();
  const byGvdb = new Map<number, ReviewQuest>();
  const raw = new Map<number, ReturnType<typeof parseRawRelations>>();
  const excluded = new Map<number, Set<ReviewExclusion>>();
  const block = (id: number, reason: ReviewExclusion) => {
    const reasons = excluded.get(id) ?? new Set<ReviewExclusion>();
    reasons.add(reason); excluded.set(id, reasons);
  };
  for (const quest of quests) {
    if (!validId(quest.id) || !validId(quest.gvdbId)) block(quest.id, "invalid_id");
    for (const duplicate of [byId.get(quest.id), byGvdb.get(quest.gvdbId)]) {
      if (duplicate) { block(quest.id, "duplicate_id"); block(duplicate.id, "duplicate_id"); }
    }
    byId.set(quest.id, quest); byGvdb.set(quest.gvdbId, quest);
    const parsed = parseRawRelations(quest.rawRowJson);
    raw.set(quest.id, parsed);
    if (!parsed.valid) block(quest.id, "malformed_raw");
  }

  const incoming = new Map<number, number[]>();
  const outgoing = new Map<number, number[]>();
  const keys = new Set<string>();
  for (const { questId, prerequisiteQuestId } of dependencies) {
    const key = `${questId}:${prerequisiteQuestId}`;
    if (keys.has(key)) block(questId, "duplicate_edge");
    keys.add(key);
    const predecessors = incoming.get(questId) ?? [];
    predecessors.push(prerequisiteQuestId); incoming.set(questId, predecessors);
    const successors = outgoing.get(prerequisiteQuestId) ?? [];
    successors.push(questId); outgoing.set(prerequisiteQuestId, successors);
    const successor = byId.get(questId), predecessor = byId.get(prerequisiteQuestId);
    if (!validId(questId) || !validId(prerequisiteQuestId)) block(questId, "invalid_id");
    if (!successor || !predecessor) {
      block(successor?.id ?? predecessor?.id ?? questId, "missing_reference");
    } else if (questId === prerequisiteQuestId) {
      block(questId, "self_reference");
    } else if (!raw.get(questId)?.prerequisites.has(predecessor.gvdbId)
      || !raw.get(prerequisiteQuestId)?.successors.has(successor.gvdbId)) {
      block(questId, "relation_mismatch");
    }
  }
  for (const quest of quests) {
    const references = raw.get(quest.id)!;
    for (const id of references.prerequisites) {
      const predecessor = byGvdb.get(id);
      if (!predecessor || !keys.has(`${quest.id}:${predecessor.id}`)) block(quest.id, "missing_reference");
    }
    for (const id of references.successors) {
      const successor = byGvdb.get(id);
      if (!successor) block(quest.id, "missing_reference");
      // A missing edge in a sibling branch affects that successor, not every child of this node.
      else if (!keys.has(`${successor.id}:${quest.id}`)) block(successor.id, "relation_mismatch");
    }
  }

  const degree = new Map([...byId.keys()].map(id => [id, incoming.get(id)?.length ?? 0]));
  const queue = [...byId.keys()].filter(id => degree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    for (const successor of outgoing.get(queue[i]!) ?? []) {
      const remaining = (degree.get(successor) ?? 0) - 1;
      degree.set(successor, remaining);
      if (remaining === 0) queue.push(successor);
    }
  }
  for (const [id, count] of degree) if (count > 0) block(id, "cycle_or_unresolved");

  // Only structural failures propagate. Multiple or special ancestors do not invalidate a safe direct pair.
  const affected = [...excluded.keys()];
  for (let i = 0; i < affected.length; i++) {
    for (const successor of outgoing.get(affected[i]!) ?? []) {
      if (!excluded.has(successor)) { block(successor, "affected_ancestor"); affected.push(successor); }
    }
  }
  const pairs: PrerequisiteReviewPair[] = [];
  for (const successor of quests) {
    const predecessors = incoming.get(successor.id) ?? [];
    if (predecessors.length !== 1 || excluded.has(successor.id)) continue;
    const predecessor = byId.get(predecessors[0]!);
    if (!predecessor || excluded.has(predecessor.id) || !successor.isActive || !predecessor.isActive
      || !matchesOfferMethod(successor.offerMethod, "group:quest") || !matchesOfferMethod(predecessor.offerMethod, "group:quest")) continue;
    pairs.push({ successor: identity(successor), prerequisite: identity(predecessor) });
  }
  return { pairs, excluded };
}

export function derivePrerequisiteProgressReview(
  index: PrerequisiteReviewIndex, completedQuestIds: ReadonlySet<number>, statuses: ReadonlyMap<number, PrerequisiteStatus>,
): PrerequisiteProgressCandidate[] {
  return index.pairs.filter(pair => completedQuestIds.has(pair.successor.id)
    && !completedQuestIds.has(pair.prerequisite.id) && statuses.get(pair.successor.id) === "UNSATISFIED")
    .map(pair => ({ ...pair, successorCompleted: true, prerequisiteCompleted: false, reason: "single_direct_prerequisite_unrecorded" }));
}
