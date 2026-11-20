import type { SearchConditionApplication } from "./application";
import type { SearchConditionIssue } from "./definition";

const fieldNames: Record<string, string> = {
  master: "マスターデータ", progress: "プロフィールの進捗", prerequisiteStatus: "前提クエスト",
  successorStatus: "後継クエスト", progressReview: "進捗の確認候補", offerMethod: "オファー方法",
  offerCity: "オファー都市", requiredSkills: "必要スキル", requiredSkillRank: "要求Rank",
  discoveries: "関連発見物の分類", category: "発見物の分類", mapState: "地図の入手",
  mapReacquisition: "地図の再入手", unreportedBreakdown: "未報告の内訳",
};

export function searchConditionIssueMessage(issue: SearchConditionIssue): string {
  const field = Object.prototype.hasOwnProperty.call(fieldNames, issue.field) ? fieldNames[issue.field] : issue.field;
  switch (issue.kind) {
    case "unsupported-version": return `この形式の検索条件は適用できません（バージョン ${issue.value}）。`;
    case "invalid": return `検索条件に対応していない項目または値があります（${field}）。`;
    case "unavailable": return `現在のマスターでは検索条件を適用できません（${field}${issue.value === undefined ? "" : `「${issue.value}」`}）。`;
    case "read-failed": return `検索条件の適用に必要な${field}を取得できませんでした。`;
  }
}

export function SearchConditionFeedback({ application }: { application: SearchConditionApplication }) {
  if (application.issue) {
    return <div className="error-banner">
      <span role="alert">{searchConditionIssueMessage(application.issue)}</span>
      <button type="button" className="button secondary" onClick={application.clearUnavailable}>一覧の条件を初期化する</button>
    </div>;
  }
  return application.waiting ? <div className="state-panel" role="status">検索条件に必要なデータを読み込んでいます…</div> : null;
}
