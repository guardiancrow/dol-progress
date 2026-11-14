import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { useProfiles } from "../../profiles/ProfileContext";
import { Sidebar, type AppPage } from "./Sidebar";
import { AppVersionInfo } from "./AppVersionInfo";
import { DisclosureIcon } from "./DisclosureIcon";
import { ProfileSelector } from "../profiles/ProfileSelector";
import { NARROW_WORKSPACE_QUERY, useResponsiveDisclosure } from "./useResponsiveDisclosure";
import { WorkspaceViewContext } from "./WorkspaceView";

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
  const menu = useResponsiveDisclosure<HTMLElement>(NARROW_WORKSPACE_QUERY);
  const [controlsByPage, setControlsByPage] = useState({ quests: true, discoveries: true });
  const controlsVisible = currentPage === "quests" || currentPage === "discoveries" ? controlsByPage[currentPage] : true;
  const id = useId();
  const controlsId = `${id}-${currentPage}-controls`;
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const controlsButtonRef = useRef<HTMLButtonElement>(null);
  const [hasControls, setHasControls] = useState(false);
  const registerControls = useCallback((element: HTMLDivElement | null) => {
    controlsRef.current = element;
    setHasControls(element !== null);
  }, []);
  const workspaceView = useMemo(() => ({ controlsVisible, controlsId, registerControls }), [controlsVisible, controlsId, registerControls]);

  function toggleControls() {
    if (currentPage !== "quests" && currentPage !== "discoveries") return;
    if (controlsVisible && controlsRef.current?.contains(document.activeElement)) {
      controlsButtonRef.current?.focus({ preventScroll: true });
    }
    setControlsByPage(current => ({ ...current, [currentPage]: !current[currentPage] }));
  }

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
      <header className="app-header">
        <div className="header-controls">
          <button type="button" className="shell-toggle" ref={menu.buttonRef}
            aria-label={menu.expanded ? "メニューを閉じる" : "メニューを開く"}
            title={menu.expanded ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={menu.expanded} aria-controls={menu.id} onClick={menu.toggle}>
            <DisclosureIcon kind="sidebar" expanded={menu.expanded} />
          </button>
          <div className="app-identity">
            <h1 title="DOL Progress Manager">DOL Progress Manager</h1>
          </div>
          {isWorkspace && <button type="button" className="shell-toggle" ref={controlsButtonRef}
            aria-label={controlsVisible ? "検索・フィルターを隠す" : "検索・フィルターを表示"}
            title={controlsVisible ? "検索・フィルターを隠す" : "検索・フィルターを表示"}
            aria-expanded={controlsVisible} aria-controls={hasControls ? controlsId : undefined}
            data-workspace-controls-toggle={controlsId} disabled={!hasControls} onClick={toggleControls}>
            <DisclosureIcon kind="top-panel" expanded={controlsVisible} />
          </button>}
          {isWorkspace && !controlsVisible && <span className="header-page-name" aria-hidden="true">{currentPage === "quests" ? "クエスト" : "発見物"}</span>}
        </div>
        <ProfileSelector profiles={profiles} selectedProfileId={selectedProfileId} disabled={isLoading} onSelect={selectProfile} />
      </header>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} id={menu.id} expanded={menu.expanded} panelRef={menu.panelRef} />
      <WorkspaceViewContext.Provider value={workspaceView}>
        <main className={`main-content${isWorkspace ? " main-content--workspace" : ""}${isWorkspace && !controlsVisible ? " main-content--table-priority" : ""}`}>
          {children}
        </main>
      </WorkspaceViewContext.Provider>
      <footer className="status-bar">
        <span>進捗データはローカルに保存されます</span>
        {version && <AppVersionInfo version={version} />}
      </footer>
    </div>
  );
}
