import type { DiscoveryRowViewModel } from "./types";

interface FirstReportPresentation {
  checked: boolean | null;
  text: string;
  label: string;
  title: string;
}

export function firstReportDisplay(row: Pick<DiscoveryRowViewModel,
  "canReport" | "firstReportStatus" | "historyPresent" | "legacyMeritCredit" |
  "effectiveReported" | "automaticReporting">): FirstReportPresentation {
  if (!row.canReport) return { checked: null, text: "対象外", label: "初回報告の対象外", title: "レリックは報告対象外です" };
  if (row.firstReportStatus === "confirmed") return { checked: true, text: "✓", label: "初回報告済み", title: "過去の初回報告を確認済みです。現在の報告状態とは別の記録です" };
  const currentReportConfirms = row.effectiveReported === true && row.automaticReporting !== true;
  if (row.firstReportStatus === "not_reported" && currentReportConfirms) {
    return { checked: null, text: "要確認", label: "初回報告履歴と現在の報告状態が矛盾", title: "初回報告前の履歴と現在報告済みの記録が一致しません。履歴の確認が必要です" };
  }
  if (row.firstReportStatus === "not_reported") return { checked: false, text: "—", label: "初回報告前", title: "過去の初回報告が未完了であることを確認済みです" };
  if (currentReportConfirms) return { checked: true, text: "✓", label: "初回報告済み", title: "現在報告済みの記録から表示しています。初回報告履歴の保存値は変更していません" };
  return { checked: null, text: "不明", label: "初回報告履歴は不明", title: row.automaticReporting
    ? "現在の自動報告状態と、過去の初回報告履歴は別の記録です。独立した履歴は未確認です"
    : row.legacyMeritCredit
    ? "旧データからの勲功値算入資格はありますが、初回報告実績は未確認です"
    : row.historyPresent === false ? "初回報告履歴が記録されていません"
    : row.historyPresent === true ? "初回報告実績は未確認です" : "初回報告履歴をまだ取得できていません" };
}
