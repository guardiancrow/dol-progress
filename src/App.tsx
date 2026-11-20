import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { BookmarkPanel } from "./components/layout/BookmarkPanel";
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
import { WorkspaceTabs, type WorkspaceTabId } from "./workspaceTabs/state";
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

function isSearchPage(page: AppPage): page is SearchBookmark["page"] {
  return page === "quests" || page === "discoveries";
}

function SearchPageSlot({ visible, children }: { visible: boolean; children: ReactNode }) {
  const workspace = useWorkspaceView();
  // A staged page can read data and validate its request before it owns the visible workspace.
  return <div hidden={!visible} className="bookmark-page-slot">
    <WorkspaceViewContext.Provider value={visible ? workspace : null}>{children}</WorkspaceViewContext.Provider>
  </div>;
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
  const [{ tabs, initialIds }] = useState(() => {
    const tabs = new WorkspaceTabs();
    return { tabs, initialIds: { quests: tabs.open("quests", "クエスト"), discoveries: tabs.open("discoveries", "発見物") } };
  });
  const [tabIds, setTabIds] = useState(initialIds);
  const [workspaceReads] = useState(() => new WorkspaceReads());
  const [discoveryNavigation, setDiscoveryNavigation] = useState<{ tabId: WorkspaceTabId; filter: DiscoveryInitialFilter }>();
  const [searchApplication, setSearchApplication] = useState<{
    source?: AppProps["searchConditionRequest"];
    request: SearchConditionRequest;
    bookmark?: SearchBookmark;
  }>();
  const [searchMessage, setSearchMessage] = useState<string>();
  const [searchNotice, setSearchNotice] = useState<string>();
  const [captured, setCaptured] = useState<{ tabId: WorkspaceTabId; condition: ConditionResult<SearchConditionDefinition> }>();
  const bookmarkLibrary = useBookmarkLibrary(bookmarkRepository);
  const [masterImport, setMasterImport] = useState({ pending: 0, revision: 0 });
  const seenRequest = useRef<AppProps["searchConditionRequest"]>(undefined);
  const settledRequest = useRef<SearchConditionRequest>(undefined);
  const noticeVersion = useRef(0);
  const { mutate: mutateBookmark } = bookmarkLibrary;
  const currentRequest = searchApplication?.request.profileId === selectedProfileId && !isProfileLoading
    && (searchApplication.source === undefined || searchApplication.source === searchConditionRequest) ? searchApplication.request : undefined;
  const visibleTabId = isSearchPage(page) ? tabIds[page] : undefined;
  const stagedTabId = currentRequest?.tabId !== visibleTabId ? currentRequest?.tabId : undefined;
  const captureVisibleTab = useCallback((condition: ConditionResult<SearchConditionDefinition> | undefined) => {
    if (visibleTabId === undefined) return;
    setCaptured(current => condition ? { tabId: visibleTabId, condition } : current?.tabId === visibleTabId ? undefined : current);
  }, [visibleTabId]);
  const consumeDiscoveryNavigation = useCallback(() => {
    setDiscoveryNavigation(current => current?.tabId === visibleTabId ? undefined : current);
  }, [visibleTabId]);
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
    setSearchApplication(undefined);
    setSearchMessage(undefined);
    setSearchNotice(undefined);
    noticeVersion.current++;
    if (!searchConditionRequest) return;

    const decoded = decodeSearchCondition(searchConditionRequest.definition);
    if (decoded.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(decoded.issue));
    } else if (selectedProfileId === null || isProfileLoading) {
      setSearchMessage("プロフィールを選択してから検索条件を適用してください。");
    } else if (decoded.value.page !== page) {
      setSearchMessage("検索条件の対象となる一覧を開いてから適用してください。");
    } else {
      setSearchApplication({ source: searchConditionRequest,
        request: { definition: decoded.value, profileId: selectedProfileId, tabId: tabIds[decoded.value.page] } });
    }
  }, [searchConditionRequest, selectedProfileId, isProfileLoading, page, tabIds]);

  useLayoutEffect(() => {
    if (searchApplication && (searchApplication.request.profileId !== selectedProfileId || isProfileLoading)) {
      setSearchApplication(current => current === searchApplication ? undefined : current);
      if (searchApplication.source === undefined || searchApplication.source === searchConditionRequest) {
        setSearchMessage("プロフィールが切り替わったため、検索条件の適用を取り消しました。");
      }
    }
  }, [searchApplication, searchConditionRequest, selectedProfileId, isProfileLoading]);

  useLayoutEffect(() => {
    if (selectedProfileId !== null) workspaceReads.invalidateProfile(selectedProfileId);
    tabs.resetPagination();
    noticeVersion.current++;
    setSearchNotice(undefined);
  }, [selectedProfileId, tabs, workspaceReads]);

  const settleSearchCondition = useCallback((request: SearchConditionRequest, result: ConditionResult<SearchTableState>) => {
    if (request !== currentRequest || request === settledRequest.current || tabs.get(request.tabId)?.page !== request.definition.page) return;
    settledRequest.current = request;
    setSearchApplication(undefined);
    if (result.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(result.issue));
      return;
    }
    tabs.updateView(request.tabId, view => applySearchCondition(view, request.definition, result.value));
    setSearchMessage(undefined);
    if (!searchApplication?.bookmark) return;

    const { bookmark } = searchApplication;
    setDiscoveryNavigation(undefined);
    setPage(request.definition.page);
    setSearchNotice(`「${bookmark.name}」を適用しました。`);
    const version = noticeVersion.current;
    void mutateBookmark(repo => repo.markUsed(bookmark.id)).catch(() => {
      if (version === noticeVersion.current) setSearchMessage("検索条件は適用されましたが、最終使用日時を保存できませんでした。");
    });
  }, [currentRequest, searchApplication, mutateBookmark, tabs]);

  function cancelSearchApplication() {
    noticeVersion.current++;
    setSearchApplication(undefined);
    setSearchMessage(undefined);
    setSearchNotice(undefined);
  }

  function openBookmark(bookmark: SearchBookmark) {
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
    setSearchApplication({ request: { definition: definition.value, profileId: selectedProfileId, tabId: tabIds[definition.value.page] }, bookmark });
  }

  function navigate(nextPage: AppPage) {
    cancelSearchApplication();
    setDiscoveryNavigation(undefined);
    setPage(nextPage);
  }

  function openDiscoveries(filter: DiscoveryInitialFilter) {
    cancelSearchApplication();
    // Phase 1 keeps one slot per page. An overview link starts a fresh discovery view.
    const tabId = tabs.open("discoveries", "発見物");
    setTabIds({ ...tabIds, discoveries: tabId });
    tabs.close(tabIds.discoveries);
    setDiscoveryNavigation({ tabId, filter });
    setPage("discoveries");
  }

  function searchPage(tabId: WorkspaceTabId) {
    const tab = tabs.get(tabId);
    if (!tab) return null;
    const visible = tabId === visibleTabId;
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
    return <SearchPageSlot key={tabId} visible={visible}>
      {tab.page === "quests" ? <QuestsPage {...shared} questRepository={questRepository} questProgressRepository={questProgressRepository} />
        : <DiscoveriesPage {...shared} discoveryRepository={discoveryRepository} discoveryProgressRepository={discoveryProgressRepository}
          initialFilter={discoveryNavigation?.tabId === tabId ? discoveryNavigation.filter : undefined} onNavigationConsumed={consumeDiscoveryNavigation} />}
    </SearchPageSlot>;
  }

  return (
    <AppShell currentPage={page} onNavigate={navigate}>
        {searchMessage && <div className="error-banner" role="alert">{searchMessage}</div>}
        {page === "overview" ? (
          <OverviewPage statsRepository={progressStatsRepository} onOpenDiscoveries={openDiscoveries} />
        ) : page === "profiles" ? (
          <ProfilesPage />
        ) : isSearchPage(page) && visibleTabId !== undefined ? (
          <div className="bookmarked-workspace">
            <BookmarkPanel page={page} captured={captured?.tabId === visibleTabId ? captured.condition : undefined} library={bookmarkLibrary} apply={openBookmark} />
            {searchNotice && <div className="bookmark-application-status" role="status">{searchNotice}</div>}
            {stagedTabId !== undefined && <div className="bookmark-application-status" role="status">適用先の一覧を読み込んでいます…</div>}
            {(stagedTabId === undefined ? [visibleTabId] : [visibleTabId, stagedTabId]).map(searchPage)}
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
