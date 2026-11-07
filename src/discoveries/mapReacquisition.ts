import type { DiscoveryRowViewModel } from "./types";

export type MapReacquisition = "unrelated" | "suppressed" | "candidate" | "review";
export const mapDiscoveryLabels: Record<MapReacquisition, string> = {
  unrelated: "", suppressed: "地図・再入手抑止", candidate: "地図・再入手候補", review: "地図・要確認",
};

// 現在の有効報告状態だけで判定する。維持意思や初回報告履歴は使用しない。
export function mapDiscoveryStatus(row: Pick<DiscoveryRowViewModel, "mapRelated" | "mapNeedsReview" | "canReport" | "progress" | "effectiveReported">): MapReacquisition {
  if (!row.mapRelated) return "unrelated";
  if (!row.canReport || row.mapNeedsReview) return "review";
  return row.progress !== null && !row.effectiveReported ? "suppressed" : "candidate";
}
