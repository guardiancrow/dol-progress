import type { DiscoveryRowViewModel } from "./types";

export type MapReacquisition = "unrelated" | "suppressed" | "candidate" | "review";
export const mapDiscoveryLabels: Record<MapReacquisition, string> = {
  unrelated: "", suppressed: "地図・再入手抑止", candidate: "地図・再入手候補", review: "地図・判定保留",
};

export function mapDiscoveryReviewReason(row: Pick<DiscoveryRowViewModel, "mapRelated" | "mapNeedsReview" | "canReport">): string | undefined {
  if (!row.mapRelated) return undefined;
  const reasons: string[] = [];
  if (row.mapNeedsReview) reasons.push("一つの地図に複数の発見物が関連しているため、再入手の判定を保留しています。");
  if (!row.canReport) reasons.push("報告対象外の発見物であるため、再入手の判定を保留しています。");
  return reasons.length ? reasons.join("\n") : undefined;
}

// 現在の有効報告状態だけで判定する。維持意思や初回報告履歴は使用しない。
export function mapDiscoveryStatus(row: Pick<DiscoveryRowViewModel, "mapRelated" | "mapNeedsReview" | "canReport" | "progress" | "effectiveReported">): MapReacquisition {
  if (!row.mapRelated) return "unrelated";
  if (!row.canReport || row.mapNeedsReview) return "review";
  return row.progress !== null && !row.effectiveReported ? "suppressed" : "candidate";
}
