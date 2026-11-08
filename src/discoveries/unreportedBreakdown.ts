import type { DiscoveryRowViewModel } from "./types";
import type { FirstReportStatus } from "./stateService";

// 未取得と、取得済みで履歴行が存在しない場合を区別する。
export function currentUnreportedHistory(row: Pick<DiscoveryRowViewModel,
  "canReport" | "progress" | "effectiveReported" | "firstReportStatus" | "historyPresent" | "unreportedHistoryReady"
>): FirstReportStatus | null {
  if (!row.canReport || row.progress === null || row.effectiveReported || row.unreportedHistoryReady === false) return null;
  if (row.historyPresent === false) return "unknown";
  return row.firstReportStatus ?? null;
}
