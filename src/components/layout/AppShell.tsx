import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { useProfiles } from "../../profiles/ProfileContext";
import { Sidebar, type AppPage } from "./Sidebar";
import { AppVersionInfo } from "./AppVersionInfo";

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
  const [version, setVersion] = useState<string | null>(null);
  const versionRequest = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let active = true;
    // StrictModeのeffect再実行でも、同じ取得Promiseを使用する。
    versionRequest.current ??= getVersion();
    void versionRequest.current.then(
      (loaded) => { if (active) setVersion(loaded); },
      () => { /* Tauri APIが使えない環境や取得失敗時は表示を省略する。 */ },
    );
    return () => { active = false; };
  }, []);

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
        <span>データはこのPCのSQLiteに保存されます</span>
        {version && <AppVersionInfo version={version} />}
      </footer>
    </div>
  );
}
