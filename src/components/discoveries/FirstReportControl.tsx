import { firstReportDisplay } from "../../discoveries/firstReport";
import type { DiscoveryRowViewModel } from "../../discoveries/types";
import type { ReportHoldController } from "../../discoveries/useReportHold";

export function FirstReportControl({ row, controller: c }: {
  row: DiscoveryRowViewModel; controller?: ReportHoldController;
}) {
  if (!row.canReport || row.automaticReporting) {
    return <span className="muted" aria-label="初回報告履歴の訂正対象外">—</span>;
  }
  const state = firstReportDisplay(row);
  if (!c) {
    return <span role="img" aria-label={`${row.name}の初回報告：${state.label}`} title={state.title}>{state.text}</span>;
  }
  const summary = c.summaries.get(row.id);
  const disabled = row.updating || c.loading || c.summaryReadState !== "ready" || c.busy || c.dialog !== null || c.selection !== null || !summary?.active;
  if (state.checked !== null) {
    const checked = state.checked;
    return <input type="checkbox" aria-label={`${row.name}の初回報告`}
      title={`${state.title}。確認画面で訂正できます。不明に戻せるのは現在が未報告・未発見の場合です。`}
      data-report-focus={`first-${row.id}`} checked={checked} disabled={disabled}
      onChange={e => {
        e.currentTarget.checked = checked;
        const knownHistory = row.firstReportStatus === "confirmed" || row.firstReportStatus === "not_reported";
        void c.open(row.id, row.name, "history", null, e.currentTarget, Boolean(row.mapRelated), knownHistory ? checked ? "not_reported" : "confirmed" : undefined);
      }} />;
  }
  return <button type="button" className="first-report-action" disabled={disabled}
    aria-label={`${row.name}の初回報告を確認`} title={`${state.title}。過去の報告実績を確認・訂正します。`}
    data-report-focus={`first-${row.id}`}
    onClick={e => void c.open(row.id, row.name, "history", null, e.currentTarget, Boolean(row.mapRelated))}>{state.text}</button>;
}
