import type { AppPage } from "../components/layout/Sidebar";

const pageLabels: Record<Exclude<AppPage, "profiles">, string> = {
  overview: "概要",
  quests: "クエスト",
  discoveries: "発見物",
  "master-data": "マスターデータ",
  "data-root": "保存場所",
};

interface PlaceholderPageProps {
  page: Exclude<AppPage, "profiles">;
}

export function PlaceholderPage({ page }: PlaceholderPageProps) {
  return (
    <section className="state-panel placeholder" aria-labelledby="placeholder-title">
      <p className="page-eyebrow">{pageLabels[page]}</p>
      <h2 id="placeholder-title">この機能は後続Phaseで実装予定です</h2>
      <p>現在はプロフィール管理を利用できます。</p>
    </section>
  );
}
