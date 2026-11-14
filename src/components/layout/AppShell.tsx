import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { useProfiles } from "../../profiles/ProfileContext";
import { Sidebar, type AppPage } from "./Sidebar";
import { AppVersionInfo } from "./AppVersionInfo";
import { COMPACT_WORKSPACE_QUERY, NARROW_WORKSPACE_QUERY, useResponsiveDisclosure } from "./useResponsiveDisclosure";

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
  const header = useResponsiveDisclosure(COMPACT_WORKSPACE_QUERY);
  const menu = useResponsiveDisclosure<HTMLElement>(NARROW_WORKSPACE_QUERY);

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
    <div className={`app-shell${menu.expanded ? "" : " app-shell--menu-closed"}`}>
      <header className={`app-header${header.expanded ? "" : " app-header--compact"}`}>
        <button type="button" className="shell-toggle" ref={menu.buttonRef}
          aria-expanded={menu.expanded} aria-controls={menu.id} onClick={menu.toggle}>
          メニュー{menu.expanded ? "を閉じる" : "を開く"}
        </button>
        <div className="app-identity">
          <div id={header.id} ref={header.panelRef} hidden={!header.expanded}>
            <p className="app-kicker">大航海時代 Online 進捗管理</p>
          </div>
          <h1 title="DOL Progress Manager">DOL Progress Manager</h1>
        </div>
        <div className="current-profile" aria-live="polite" role="group" aria-label="選択中プロフィール">
          <span id={`${header.id}-profile`} hidden={!header.expanded}>選択中プロフィール</span>
          <strong title={selectedProfile?.name ?? "未選択"}>{selectedProfile?.name ?? "未選択"}</strong>
        </div>
        <button type="button" className="shell-toggle" ref={header.buttonRef}
          aria-expanded={header.expanded} aria-controls={`${header.id} ${header.id}-profile`} onClick={header.toggle}>
          ヘッダー{header.expanded ? "を縮める" : "を展開"}
        </button>
      </header>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} id={menu.id} expanded={menu.expanded} panelRef={menu.panelRef} />
      <main className={`main-content${isWorkspace ? " main-content--workspace" : ""}`}>
        {children}
      </main>
      <footer className="status-bar">
        <span>進捗データはローカルに保存されます</span>
        {version && <AppVersionInfo version={version} />}
      </footer>
    </div>
  );
}
