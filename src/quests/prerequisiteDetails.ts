import type { QuestWithDiscoveries } from "../domain/models";
import type { DirectPrerequisite } from "./directPrerequisites";
import { matchesOfferMethod } from "./offerMethods";
import type { PrerequisiteReviewIndex, ReviewExclusion, ReviewQuestIdentity } from "./prerequisiteProgressReview";
import type { QuestDependency } from "./prerequisites";

export interface PrerequisiteDetailsData {
  quests: ReadonlyMap<number, ReviewQuestIdentity>;
  direct: ReadonlyMap<number, readonly DirectPrerequisite[]>;
  reasons: ReadonlyMap<number, readonly string[]>;
  recordReasons: ReadonlyMap<number, readonly string[]>;
}

const exclusionReasons: Record<ReviewExclusion, string> = {
  invalid_id: "識別IDが不正なため、関係を確認できません。",
  duplicate_id: "識別IDが重複しているため、対象を一意に確認できません。",
  malformed_raw: "原文の参照情報を読み取れないため、関係を確認できません。",
  duplicate_edge: "正規化された前提関係に重複があります。",
  missing_reference: "原文参照または正規化された関係の参照先を確認できません。",
  relation_mismatch: "原文参照と正規化された関係の整合性を確認できません。",
  self_reference: "自己参照があるため、関係を確認できません。",
  cycle_or_unresolved: "循環または未解決の参照があるため、関係を確認できません。",
  affected_ancestor: "前提側に構造上の問題があり、関係を確認できません。",
};

/** Display only canonical direct relations. Review diagnostics never grant completion permission. */
export function buildPrerequisiteDetailsData(
  masters: readonly QuestWithDiscoveries[], dependencies: readonly QuestDependency[],
  direct: PrerequisiteDetailsData["direct"], reviewIndex?: PrerequisiteReviewIndex,
): PrerequisiteDetailsData {
  const byId = new Map(masters.map(({ quest }) => [quest.id, quest]));
  const incoming = new Map<number, Set<number>>();
  for (const edge of dependencies) {
    const ids = incoming.get(edge.questId) ?? new Set<number>();
    ids.add(edge.prerequisiteQuestId); incoming.set(edge.questId, ids);
  }
  const reasons = new Map<number, string[]>();
  const recordReasons = new Map<number, string[]>();
  for (const { quest } of masters) {
    const values = new Set<string>();
    if (!reviewIndex) values.add("構造診断の結果を確認できません。");
    for (const reason of reviewIndex?.excluded.get(quest.id) ?? []) values.add(exclusionReasons[reason]);
    const ids = incoming.get(quest.id) ?? new Set<number>();
    if (ids.size > 1) values.add("複数前提のAND/OR条件は未確定です。各記録を個別に確認してください。");
    const ownReasons: string[] = [];
    if (!quest.isActive) ownReasons.push("inactiveのクエストです。記録の参照だけを行います。");
    if (!matchesOfferMethod(quest.offerMethod, "group:quest")) ownReasons.push("地図・特殊クエストの条件は、通常クエストの達成記録だけでは確認できません。");
    recordReasons.set(quest.id, ownReasons);
    for (const reason of ownReasons) values.add(reason);
    for (const id of ids) {
      const previous = byId.get(id);
      if (!previous) values.add("直接前提のマスターが欠損しているため、すべての前提名を表示できません。");
      else if (!previous.isActive || !matchesOfferMethod(previous.offerMethod, "group:quest")) values.add("直接前提にinactiveまたは地図・特殊クエストが含まれます。");
    }
    reasons.set(quest.id, [...values]);
  }
  return {
    quests: new Map(masters.map(({ quest: { id, gvdbId, title } }) => [id, { id, gvdbId, title }])),
    direct, reasons, recordReasons,
  };
}

export interface PrerequisiteDetailsView {
  data: PrerequisiteDetailsData;
  currentId: number;
  recordedAtOpen: boolean;
  completed: ReadonlySet<number>;
  canGoBack: boolean;
  cycleMessage: string | null;
  onOpen(id: number): void;
  onBack(): void;
  onRecheck(): void;
}
