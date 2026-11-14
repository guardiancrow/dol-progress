import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { useProfiles } from "../../profiles/ProfileContext";
import { Sidebar, type AppPage } from "./Sidebar";
import { AppVersionInfo } from "./AppVersionInfo";
import { DisclosureIcon } from "./DisclosureIcon";
import { ProfileSelector } from "../profiles/ProfileSelector";
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
  const { isLoading, profiles, selectedProfileId, selectProfile } = useProfiles();
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
        <div className="header-controls">
          <button type="button" className="shell-toggle" ref={menu.buttonRef}
            aria-label={menu.expanded ? "メニューを閉じる" : "メニューを開く"}
            title={menu.expanded ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={menu.expanded} aria-controls={menu.id} onClick={menu.toggle}>
            <DisclosureIcon kind="sidebar" expanded={menu.expanded} />
          </button>
          <div className="app-identity">
            <div id={header.id} ref={header.panelRef} hidden={!header.expanded}>
              <p className="app-kicker">大航海時代 Online 進捗管理</p>
            </div>
            <h1 title="DOL Progress Manager">DOL Progress Manager</h1>
          </div>
          <button type="button" className="shell-toggle" ref={header.buttonRef}
            aria-label={header.expanded ? "ヘッダーを縮める" : "ヘッダーを展開"}
            title={header.expanded ? "ヘッダーを縮める" : "ヘッダーを展開"}
            aria-expanded={header.expanded} aria-controls={header.id} onClick={header.toggle}>
            <DisclosureIcon kind="chevron" expanded={header.expanded} />
          </button>
        </div>
        <ProfileSelector profiles={profiles} selectedProfileId={selectedProfileId} disabled={isLoading} onSelect={selectProfile} />
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
