import type { ReactNode } from "react";

import { useProfiles } from "../../profiles/ProfileContext";
import { Sidebar, type AppPage } from "./Sidebar";

interface AppShellProps {
  currentPage: AppPage;
  onNavigate(page: AppPage): void;
  children: ReactNode;
}

export function AppShell({
  currentPage,
  onNavigate,
  children,
}: AppShellProps) {
  const { selectedProfile } = useProfiles();
  const isWorkspace = currentPage === "quests" || currentPage === "discoveries";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">大航海時代 Online 進捗管理</p>
          <h1>DOL Progress Manager</h1>
        </div>
        <div className="current-profile" aria-live="polite">
          <span>選択中プロフィール</span>
          <strong>{selectedProfile?.name ?? "未選択"}</strong>
        </div>
      </header>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main className={`main-content${isWorkspace ? " main-content--workspace" : ""}`}>
        {children}
      </main>
      <footer className="status-bar">
        データはこのPCのSQLiteに保存されます
      </footer>
    </div>
  );
}
