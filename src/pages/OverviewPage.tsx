import { useEffect, useRef, useState } from "react";

import type {
  DiscoveryCategoryProgressStats,
  ProgressStats,
  ProgressStatsRepositoryPort,
} from "../overview/types";
import { useProfiles } from "../profiles/ProfileContext";

interface OverviewPageProps {
  statsRepository: ProgressStatsRepositoryPort;
  onOpenDiscoveryCategory(categoryId: number): void;
}

export function OverviewPage({ statsRepository, onOpenDiscoveryCategory }: OverviewPageProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    setStats(null);
    setError(null);
    if (selectedProfileId === null) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void statsRepository
      .getForProfile(selectedProfileId)
      .then((loaded) => {
        if (generation.current === currentGeneration) setStats(loaded);
      })
      .catch((caught: unknown) => {
        console.error("Progress stats load failed", caught);
        if (generation.current === currentGeneration) {
          setError("進捗集計を読み込めませんでした。");
        }
      })
      .finally(() => {
        if (generation.current === currentGeneration) setIsLoading(false);
      });
  }, [reload, selectedProfileId, statsRepository]);

  if (isProfileLoading) {
    return <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>;
  }
  if (selectedProfileId === null) {
    return (
      <div className="state-panel empty-state">
        <h2>進捗を表示するプロフィールを選択してください</h2>
        <p>プロフィール画面でプロフィールを作成または選択してください。</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="overview-title">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">進捗サマリー</p>
          <h2 id="overview-title">概要</h2>
          <p>現在有効なマスターデータに対する進捗を表示します。</p>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="button secondary" onClick={() => setReload((value) => value + 1)}>再読み込み</button>
        </div>
      )}
      {isLoading ? (
        <div className="state-panel" role="status">進捗を集計しています…</div>
      ) : error || stats === null ? null : (
        <OverviewContent stats={stats} onOpenDiscoveryCategory={onOpenDiscoveryCategory} />
      )}
    </section>
  );
}

function OverviewContent({ stats, onOpenDiscoveryCategory }: { stats: ProgressStats; onOpenDiscoveryCategory(categoryId: number): void }) {
  const questRate = percentage(stats.quests.completed, stats.quests.total);
  const discoveryRate = percentage(stats.discoveries.discovered, stats.discoveries.total);
  const cardCapableDiscovered = stats.discoveries.cardCapableDiscovered;
  const cardRate = cardCapableDiscovered === 0
    ? null
    : percentage(stats.discoveries.cardOwned, cardCapableDiscovered);

  return (
    <>
      <div className="overview-summary-grid overview-summary-grid--primary" role="group" aria-label="主要な進捗">
        <ProgressCard
          title="Quest"
          label="達成"
          value={stats.quests.completed}
          total={stats.quests.total}
          rate={questRate}
          details={`未達成 ${formatNumber(stats.quests.incomplete)}件`}
        />
        <ProgressCard
          title="Discovery"
          label="発見"
          value={stats.discoveries.discovered}
          total={stats.discoveries.total}
          rate={discoveryRate}
          details={`未発見 ${formatNumber(stats.discoveries.undiscovered)}件・報告済み ${formatNumber(stats.discoveries.reported)}件`}
        />
        <AdventureMeritCard merit={stats.adventureMerit} />
      </div>
      <div className="overview-summary-grid overview-summary-grid--secondary" role="group" aria-label="補助的な進捗">
        <MetricCard title="未報告" value={`${formatNumber(stats.discoveries.unreported)}件`} description="発見済み・未報告" />
        <ProgressCard
          title="カード所有"
          label="所有"
          value={stats.discoveries.cardOwned}
          total={cardCapableDiscovered}
          rate={cardRate}
          details="カード対象の発見済み発見物を分母に集計"
        />
      </div>

      <section className="category-progress" aria-labelledby="category-progress-title">
        <div className="section-heading">
          <h3 id="category-progress-title">発見物分類別</h3>
          <p>有効な発見物が存在する分類だけを表示します。</p>
        </div>
        {stats.categories.length === 0 ? (
          <div className="state-panel empty-state"><p>集計対象の発見物分類がありません。</p></div>
        ) : (
          <div className="category-list" role="list">
            {stats.categories.map((category) => (
              <CategoryProgress key={category.categoryId} category={category} onOpen={onOpenDiscoveryCategory} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AdventureMeritCard({ merit }: { merit: ProgressStats["adventureMerit"] }) {
  return (
    <article className="overview-card metric-card">
      <h3>冒険勲功値（判明分）</h3>
      <p className="overview-value">{formatNumber(merit.knownMerit)}</p>
      <p className="overview-detail">報告済み発見物 {formatNumber(merit.reportedCount)}件・経験値判明 {formatNumber(merit.knownExperienceCount)}件・経験値不明 {formatNumber(merit.unknownExperienceCount)}件</p>
      <p className="overview-detail">大航海時代データベースに記載された報告済み発見物の経験値から算出した参考値です。</p>
      {merit.unknownExperienceCount > 0 && (
        <p className="overview-detail">経験値未登録の発見物は合計に含まれていません。</p>
      )}
    </article>
  );
}

interface ProgressCardProps {
  title: string;
  label: string;
  value: number;
  total: number;
  rate: number | null;
  details: string;
}

function ProgressCard({ title, label, value, total, rate, details }: ProgressCardProps) {
  const rateLabel = rate === null ? "—" : `${rate.toFixed(1)}%`;
  return (
    <article className="overview-card">
      <h3>{title}</h3>
      <p className="overview-value">{label} {formatNumber(value)} / {formatNumber(total)}</p>
      <p className="overview-rate">{rateLabel}</p>
      <progress
        value={value}
        max={total > 0 ? total : 1}
        aria-label={`${title}: ${label} ${formatNumber(value)} / ${formatNumber(total)}、${rateLabel}`}
      />
      <p className="overview-detail">{details}</p>
    </article>
  );
}

function MetricCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <article className="overview-card metric-card">
      <h3>{title}</h3>
      <p className="overview-value">{value}</p>
      <p className="overview-detail">{description}</p>
    </article>
  );
}

function CategoryProgress({ category, onOpen }: { category: DiscoveryCategoryProgressStats; onOpen(categoryId: number): void }) {
  const rate = percentage(category.discovered, category.total);
  const rateLabel = `${rate.toFixed(1)}%`;
  return (
    <article className="category-row" role="listitem">
      <div className="category-title">
        <h4>{category.categoryName}</h4>
        <span>{formatNumber(category.discovered)} / {formatNumber(category.total)}</span>
      </div>
      <div className="category-meter">
        <progress
          value={category.discovered}
          max={category.total > 0 ? category.total : 1}
          aria-label={`${category.categoryName}: 発見 ${formatNumber(category.discovered)} / ${formatNumber(category.total)}、${rateLabel}`}
        />
        <strong>{rateLabel}</strong>
      </div>
      <p>未発見 {formatNumber(category.undiscovered)}件・{category.canReport ? `未報告 ${formatNumber(category.unreported)}件` : "報告: 対象外"}・{category.hasCard ? `カード所有 ${formatNumber(category.cardOwned)}件` : "カード: 対象外"}</p>
      <button
        type="button"
        className="category-drilldown"
        aria-label={`${category.categoryName}の発見物一覧を開く`}
        onClick={() => onOpen(category.categoryId)}
      />
    </article>
  );
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}
