import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { BookmarkPanel } from "./components/layout/BookmarkPanel";
import { WorkspaceTabBar, workspacePanelId, workspaceTabId, type WorkspaceFocus } from "./components/layout/WorkspaceTabBar";
import { useWorkspaceView, WorkspaceViewContext } from "./components/layout/WorkspaceView";
import type { AppPage } from "./components/layout/Sidebar";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { DataRootSettingsPage } from "./pages/DataRootSettingsPage";
import type { DataRootInfo } from "./dataRoot/service";
import { OverviewPage } from "./pages/OverviewPage";
import { MasterDataPage } from "./pages/MasterDataPage";
import { DiscoveriesPage } from "./pages/DiscoveriesPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { QuestsPage } from "./pages/QuestsPage";
import {
  ProfileProvider,
  useProfiles,
  type ProfileRepositoryPort,
} from "./profiles/ProfileContext";
import { ProfileRepository } from "./repositories/profileRepository";
import { DiscoveryProgressRepository } from "./repositories/discoveryProgressRepository";
import { DiscoveryRepository } from "./repositories/discoveryRepository";
import { QuestProgressRepository } from "./repositories/questProgressRepository";
import { QuestRepository } from "./repositories/questRepository";
import { ProgressStatsRepository } from "./repositories/progressStatsRepository";
import type { ProgressStatsRepositoryPort } from "./overview/types";
import { ImportService } from "./importer";
import type { MasterDataStatusRepositoryPort, MasterImportServicePort } from "./masterData/types";
import { MasterDataStatusRepository } from "./repositories/masterDataStatusRepository";
import type {
  QuestProgressRepositoryPort,
  QuestRepositoryPort,
} from "./quests/types";
import type {
  DiscoveryProgressRepositoryPort,
  DiscoveryRepositoryPort,
  DiscoveryInitialFilter,
} from "./discoveries/types";
import { BackupRestoreService, type BackupRestoreServicePort } from "./backupRestore";
import { ProgressLinkService, type ProgressLinkServicePort } from "./progressLink";
import { decodeSearchCondition, type ConditionResult, type SearchConditionDefinition } from "./searchConditions/definition";
import { applySearchCondition, type SearchConditionRequest } from "./searchConditions/application";
import type { SearchTableState } from "./searchConditions/tableState";
import { searchConditionIssueMessage } from "./searchConditions/SearchConditionFeedback";
import { SearchBookmarkRepository, type SearchBookmark } from "./repositories/searchBookmarkRepository";
import { useBookmarkLibrary, type BookmarkRepository } from "./searchConditions/useBookmarkLibrary";
import { MAX_WORKSPACE_TABS, WorkspaceTabs, type WorkspacePage, type WorkspaceTabId } from "./workspaceTabs/state";
import { WorkspaceReads } from "./workspaceReads/WorkspaceReads";

interface AppProps {
  profileRepository?: ProfileRepositoryPort;
  questRepository?: QuestRepositoryPort;
  questProgressRepository?: QuestProgressRepositoryPort;
  discoveryRepository?: DiscoveryRepositoryPort;
  discoveryProgressRepository?: DiscoveryProgressRepositoryPort;
  progressStatsRepository?: ProgressStatsRepositoryPort;
  masterDataStatusRepository?: MasterDataStatusRepositoryPort;
  masterImportService?: MasterImportServicePort;
  backupRestoreService?: BackupRestoreServicePort;
  progressLinkService?: ProgressLinkServicePort;
  dataRootInfo?: DataRootInfo;
  bookmarkRepository?: BookmarkRepository;
  // One-shot input for the current workspace. A new request has a new object identity.
  searchConditionRequest?: { definition: unknown };
}

const defaultProfileRepository = new ProfileRepository();
const defaultQuestRepository = new QuestRepository();
const defaultQuestProgressRepository = new QuestProgressRepository();
const defaultDiscoveryRepository = new DiscoveryRepository();
const defaultDiscoveryProgressRepository = new DiscoveryProgressRepository();
const defaultProgressStatsRepository = new ProgressStatsRepository();
const defaultMasterDataStatusRepository = new MasterDataStatusRepository();
const defaultMasterImportService = new ImportService();
const defaultBackupRestoreService = new BackupRestoreService();
const defaultProgressLinkService = new ProgressLinkService();
const defaultBookmarkRepository = new SearchBookmarkRepository();

function isSearchPage(page: AppPage): page is WorkspacePage {
  return page === "quests" || page === "discoveries";
}

function SearchPageSlot({ tabId, visible, children }: { tabId: WorkspaceTabId; visible: boolean; children?: ReactNode }) {
  const workspace = useWorkspaceView();
  // A staged page can read data and validate its request before it owns the visible workspace.
  return <div hidden={!visible} className="bookmark-page-slot" role="tabpanel" id={workspacePanelId(tabId)}
    aria-labelledby={workspaceTabId(tabId)} tabIndex={visible ? 0 : undefined}>
    <WorkspaceViewContext.Provider value={visible ? workspace : null}>{children}</WorkspaceViewContext.Provider>
  </div>;
}

const tabLimitMessage = `一覧タブは${MAX_WORKSPACE_TABS}件まで開けます。追加するには、開いているタブを閉じてください。`;

interface PendingSearchApplication {
  source?: AppProps["searchConditionRequest"];
  request: SearchConditionRequest;
  bookmark?: SearchBookmark;
}

function App(props: AppProps) {
  return <ProfileProvider repository={props.profileRepository ?? defaultProfileRepository}>
    <AppContent {...props} />
  </ProfileProvider>;
}

function AppContent({
  questRepository = defaultQuestRepository,
  questProgressRepository = defaultQuestProgressRepository,
  discoveryRepository = defaultDiscoveryRepository,
  discoveryProgressRepository = defaultDiscoveryProgressRepository,
  progressStatsRepository = defaultProgressStatsRepository,
  masterDataStatusRepository = defaultMasterDataStatusRepository,
  masterImportService = defaultMasterImportService,
  backupRestoreService = defaultBackupRestoreService,
  progressLinkService = defaultProgressLinkService,
  dataRootInfo = { mode: "default", dataRoot: "", databasePath: "", portableRoot: "", defaultDataRoot: "", configRoot: "", defaultDatabasePath: "", defaultDatabaseExists: false },
  searchConditionRequest,
  bookmarkRepository = defaultBookmarkRepository,
}: AppProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const [page, setPage] = useState<AppPage>("profiles");
  const [tabs] = useState(() => new WorkspaceTabs());
  const openTabs = useSyncExternalStore(tabs.subscribe, tabs.getOpenTabs);
  const [activeTabId, setActiveTabId] = useState<WorkspaceTabId>();
  const recentTabs = useRef<WorkspaceTabId[]>([]);
  const [focusRequest, setFocusRequest] = useState<WorkspaceFocus>();
  const overviewUndo = useRef<HTMLButtonElement>(null);
  const [workspaceReads] = useState(() => new WorkspaceReads());
  const [discoveryNavigation, setDiscoveryNavigation] = useState(() => new Map<WorkspaceTabId, DiscoveryInitialFilter>());
  const [searchApplication, setSearchApplication] = useState<PendingSearchApplication>();
  const pendingRequest = useRef<SearchConditionRequest>(undefined);
  const [searchMessage, setSearchMessage] = useState<string>();
  const [searchNotice, setSearchNotice] = useState<string>();
  const [captured, setCaptured] = useState<{ tabId: WorkspaceTabId; condition: ConditionResult<SearchConditionDefinition> }>();
  const bookmarkLibrary = useBookmarkLibrary(bookmarkRepository);
  const [masterImport, setMasterImport] = useState({ pending: 0, revision: 0 });
  const seenRequest = useRef<AppProps["searchConditionRequest"]>(undefined);
  const noticeVersion = useRef(0);
  const { mutate: mutateBookmark } = bookmarkLibrary;
  const currentRequest = searchApplication?.request.profileId === selectedProfileId && !isProfileLoading
    && (searchApplication.source === undefined || searchApplication.source === searchConditionRequest) ? searchApplication.request : undefined;
  const visibleTabId = isSearchPage(page) ? activeTabId : undefined;
  const stagedTabId = currentRequest && currentRequest.tabId !== visibleTabId
    && !openTabs.some(tab => tab.id === currentRequest.tabId) ? currentRequest.tabId : undefined;
  const captureVisibleTab = useCallback((condition: ConditionResult<SearchConditionDefinition> | undefined) => {
    if (visibleTabId === undefined) return;
    setCaptured(current => condition ? { tabId: visibleTabId, condition } : current?.tabId === visibleTabId ? undefined : current);
  }, [visibleTabId]);
  const clearDiscoveryNavigation = useCallback((tabId: WorkspaceTabId) => {
    setDiscoveryNavigation(current => {
      if (!current.has(tabId)) return current;
      const next = new Map(current);
      next.delete(tabId);
      return next;
    });
  }, []);

  const activateTab = useCallback((id: WorkspaceTabId, focus = false) => {
    const tab = tabs.get(id);
    if (!tab) return;
    recentTabs.current = [id, ...recentTabs.current.filter(previous => previous !== id)];
    setActiveTabId(id);
    setPage(tab.page);
    setFocusRequest(focus ? { tabId: id } : undefined);
  }, [tabs]);

  const discardApplication = useCallback(() => {
    const request = pendingRequest.current;
    pendingRequest.current = undefined;
    if (request) tabs.discardStaged(request.tabId);
    setSearchApplication(undefined);
  }, [tabs]);

  function beginApplication(application: PendingSearchApplication) {
    pendingRequest.current = application.request;
    setSearchApplication(application);
  }
  const trackMasterImport = useCallback(() => {
    setMasterImport(current => ({ ...current, pending: current.pending + 1 }));
    return (committed: boolean) => {
      if (committed) workspaceReads.invalidateMaster();
      setMasterImport(current => ({
        pending: current.pending - 1,
        revision: current.revision + (committed ? 1 : 0),
      }));
    };
  }, [workspaceReads]);

  useLayoutEffect(() => {
    if (seenRequest.current === searchConditionRequest) return;
    seenRequest.current = searchConditionRequest;
    discardApplication();
    setSearchMessage(undefined);
    setSearchNotice(undefined);
    noticeVersion.current++;
    if (!searchConditionRequest) return;

    const decoded = decodeSearchCondition(searchConditionRequest.definition);
    if (decoded.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(decoded.issue));
    } else if (selectedProfileId === null || isProfileLoading) {
      setSearchMessage("プロフィールを選択してから検索条件を適用してください。");
    } else if (decoded.value.page !== page || visibleTabId === undefined) {
      setSearchMessage("検索条件の対象となる一覧を開いてから適用してください。");
    } else {
      beginApplication({ source: searchConditionRequest,
        request: { definition: decoded.value, profileId: selectedProfileId, tabId: visibleTabId } });
    }
  }, [searchConditionRequest, selectedProfileId, isProfileLoading, page, visibleTabId, discardApplication]);

  useLayoutEffect(() => {
    if (searchApplication && (searchApplication.request.profileId !== selectedProfileId || isProfileLoading)) {
      if (pendingRequest.current !== searchApplication.request) return;
      discardApplication();
      if (searchApplication.source === undefined || searchApplication.source === searchConditionRequest) {
        setSearchMessage("プロフィールが切り替わったため、検索条件の適用を取り消しました。");
      }
    }
  }, [searchApplication, searchConditionRequest, selectedProfileId, isProfileLoading, discardApplication]);

  useLayoutEffect(() => {
    if (selectedProfileId !== null) workspaceReads.invalidateProfile(selectedProfileId);
    tabs.resetPagination();
    noticeVersion.current++;
    setSearchNotice(undefined);
  }, [selectedProfileId, tabs, workspaceReads]);

  useLayoutEffect(() => {
    if (focusRequest && "undo" in focusRequest) overviewUndo.current?.focus();
  }, [focusRequest]);

  const settleSearchCondition = useCallback((request: SearchConditionRequest, result: ConditionResult<SearchTableState>) => {
    if (request !== currentRequest || request !== pendingRequest.current || tabs.get(request.tabId)?.page !== request.definition.page) return;
    pendingRequest.current = undefined;
    setSearchApplication(undefined);
    if (result.status === "blocked") {
      tabs.discardStaged(request.tabId);
      setSearchMessage(searchConditionIssueMessage(result.issue));
      return;
    }
    tabs.updateView(request.tabId, view => applySearchCondition(view, request.definition, result.value));
    tabs.publishTab(request.tabId);
    setSearchMessage(undefined);
    if (!searchApplication?.bookmark) return;

    const { bookmark } = searchApplication;
    clearDiscoveryNavigation(request.tabId);
    activateTab(request.tabId);
    setSearchNotice(`「${bookmark.name}」を適用しました。`);
    const version = noticeVersion.current;
    void mutateBookmark(repo => repo.markUsed(bookmark.id)).catch(() => {
      if (version === noticeVersion.current) setSearchMessage("検索条件は適用されましたが、最終使用日時を保存できませんでした。");
    });
  }, [currentRequest, searchApplication, mutateBookmark, tabs, clearDiscoveryNavigation, activateTab]);

  function cancelSearchApplication() {
    noticeVersion.current++;
    discardApplication();
    setSearchMessage(undefined);
    setSearchNotice(undefined);
  }

  function openBookmark(bookmark: SearchBookmark, inNewTab = false) {
    cancelSearchApplication();
    if (bookmark.definition.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(bookmark.definition.issue));
      return;
    }
    if (selectedProfileId === null || isProfileLoading) {
      setSearchMessage("プロフィールを選択してから検索条件を適用してください。");
      return;
    }
    const definition = decodeSearchCondition(bookmark.definition.value);
    if (definition.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(definition.issue));
      return;
    }
    const tabId = inNewTab || definition.value.page !== page ? tabs.open(definition.value.page, bookmark.name, true) : visibleTabId;
    if (tabId === undefined) {
      setSearchMessage(tabLimitMessage);
      return;
    }
    beginApplication({ request: { definition: definition.value, profileId: selectedProfileId, tabId }, bookmark });
  }

  function navigate(nextPage: AppPage) {
    cancelSearchApplication();
    if (!isSearchPage(nextPage)) {
      setFocusRequest(undefined);
      setPage(nextPage);
      return;
    }
    const recent = recentTabs.current.find(id => tabs.get(id)?.page === nextPage);
    openTab(recent ?? tabs.open(nextPage));
  }

  function openTab(id: WorkspaceTabId | undefined, focus = false) {
    if (id === undefined) setSearchMessage(tabLimitMessage);
    else activateTab(id, focus);
  }

  function createTab(target: WorkspacePage) {
    cancelSearchApplication();
    openTab(tabs.open(target), true);
  }

  function selectTab(id: WorkspaceTabId) {
    cancelSearchApplication();
    activateTab(id);
  }

  function closeTab(id: WorkspaceTabId) {
    if (!tabs.getOpenTabs().some(tab => tab.id === id)) return;
    cancelSearchApplication();
    recentTabs.current = recentTabs.current.filter(previous => previous !== id);
    clearDiscoveryNavigation(id);
    const adjacent = tabs.close(id);
    if (adjacent !== undefined) activateTab(adjacent, true);
    else {
      setActiveTabId(undefined);
      setPage("overview");
      setFocusRequest({ undo: true });
    }
  }

  function restoreTab() {
    cancelSearchApplication();
    openTab(tabs.restore(), true);
  }

  function openDiscoveries(filter: DiscoveryInitialFilter) {
    cancelSearchApplication();
    const tabId = tabs.open("discoveries");
    if (tabId !== undefined) setDiscoveryNavigation(current => new Map(current).set(tabId, filter));
    openTab(tabId, true);
  }

  function searchPage(tabId: WorkspaceTabId) {
    const tab = tabs.get(tabId);
    if (!tab) return null;
    const visible = tabId === visibleTabId;
    if (!visible && tabId !== stagedTabId) return <SearchPageSlot key={tabId} tabId={tabId} visible={false} />;
    const shared = {
      onOpenMasterData: () => navigate("master-data"),
      progressLinkService,
      workspaceReads,
      workspaceTab: { tabs, id: tabId },
      staged: !visible,
      searchConditionRequest: currentRequest?.tabId === tabId ? currentRequest : undefined,
      onSearchConditionSettled: settleSearchCondition,
      onBookmarkCapture: visible ? captureVisibleTab : undefined,
      masterRevision: masterImport.revision,
      masterImporting: masterImport.pending > 0,
    };
    return <SearchPageSlot key={tabId} tabId={tabId} visible={visible}>
      {tab.page === "quests" ? <QuestsPage {...shared} questRepository={questRepository} questProgressRepository={questProgressRepository} />
        : <DiscoveriesPage {...shared} discoveryRepository={discoveryRepository} discoveryProgressRepository={discoveryProgressRepository}
          initialFilter={discoveryNavigation.get(tabId)} onNavigationConsumed={() => clearDiscoveryNavigation(tabId)} />}
    </SearchPageSlot>;
  }

  return (
    <AppShell currentPage={page} onNavigate={navigate}>
        {searchMessage && <div className="error-banner" role="alert">{searchMessage}</div>}
        {page === "overview" ? (
          <>
            {openTabs.length === 0 && tabs.closedName !== undefined && <button className="button secondary workspace-overview-undo"
              ref={overviewUndo} type="button" title={`「${tabs.closedName}」を復元`} onClick={restoreTab}>元に戻す</button>}
            <OverviewPage statsRepository={progressStatsRepository} onOpenDiscoveries={openDiscoveries} />
          </>
        ) : page === "profiles" ? (
          <ProfilesPage />
        ) : isSearchPage(page) && visibleTabId !== undefined ? (
          <div className="bookmarked-workspace">
            <WorkspaceTabBar tabs={openTabs} activeId={visibleTabId} closedName={tabs.closedName} focusRequest={focusRequest}
              onSelect={selectTab} onCreate={createTab} onRename={(id, name) => tabs.rename(id, name)} onClose={closeTab} onRestore={restoreTab} />
            <div className="workspace-sheet">
              <BookmarkPanel page={page} tabId={visibleTabId} captured={captured?.tabId === visibleTabId ? captured.condition : undefined} library={bookmarkLibrary} apply={openBookmark} />
              {searchNotice && <div className="bookmark-application-status" role="status">{searchNotice}</div>}
              {stagedTabId !== undefined && <div className="bookmark-application-status" role="status">適用先の一覧を読み込んでいます…</div>}
              {openTabs.map(tab => tab.id).concat(stagedTabId === undefined ? [] : [stagedTabId]).map(searchPage)}
            </div>
          </div>
        ) : page === "master-data" ? (
          <MasterDataPage
            statusRepository={masterDataStatusRepository}
            importService={masterImportService}
            backupRestoreService={backupRestoreService}
            onImportStarted={trackMasterImport}
          />
        ) : page === "data-root" ? (
          <DataRootSettingsPage info={dataRootInfo} />
        ) : (
          <PlaceholderPage page={page} />
        )}
    </AppShell>
  );
}

export default App;
