import { useProfiles } from "../../profiles/ProfileContext";
import { ProfileSelector } from "../profiles/ProfileSelector";

export type AppPage = "overview" | "quests" | "discoveries" | "profiles" | "master-data" | "data-root";

const navigation: Array<{ id: AppPage; label: string }> = [
  { id: "overview", label: "概要" },
  { id: "quests", label: "クエスト" },
  { id: "discoveries", label: "発見物" },
  { id: "profiles", label: "プロフィール" },
  { id: "master-data", label: "マスターデータ" },
  { id: "data-root", label: "保存場所" },
];

interface SidebarProps {
  currentPage: AppPage;
  onNavigate(page: AppPage): void;
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { isLoading, profiles, selectedProfileId, selectProfile } =
    useProfiles();

  return (
    <aside className="sidebar">
      <ProfileSelector
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        disabled={isLoading}
        onSelect={selectProfile}
      />
      <nav aria-label="メインナビゲーション" className="navigation">
        {navigation.map((item) => (
          <button
            key={item.id}
            className="navigation-button"
            aria-current={currentPage === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
