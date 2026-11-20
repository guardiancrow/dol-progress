import { useCallback, useLayoutEffect, useRef, useState } from "react";

import "./App.css";
import { AppShell } from "./components/layout/AppShell";
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
import { decodeSearchCondition, type SearchConditionIssue } from "./searchConditions/definition";
import type { SearchConditionRequest } from "./searchConditions/application";
import { searchConditionIssueMessage } from "./searchConditions/SearchConditionFeedback";

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
}: AppProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const [page, setPage] = useState<AppPage>("profiles");
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryInitialFilter | undefined>();
  const [searchApplication, setSearchApplication] = useState<{
    source: NonNullable<AppProps["searchConditionRequest"]>;
    request: SearchConditionRequest;
  }>();
  const [searchMessage, setSearchMessage] = useState<string>();
  const [masterImport, setMasterImport] = useState({ pending: 0, revision: 0 });
  const seenRequest = useRef<AppProps["searchConditionRequest"]>(undefined);
  const currentRequest = searchApplication?.source === searchConditionRequest && searchApplication?.request.profileId === selectedProfileId
    && searchApplication.request.definition.page === page ? searchApplication.request : undefined;
  const consumeDiscoveryNavigation = useCallback(() => setDiscoveryFilter(undefined), []);
  const trackMasterImport = useCallback(() => {
    setMasterImport(current => ({ ...current, pending: current.pending + 1 }));
    return (committed: boolean) => setMasterImport(current => ({
      pending: current.pending - 1,
      revision: current.revision + (committed ? 1 : 0),
    }));
  }, []);

  useLayoutEffect(() => {
    if (seenRequest.current === searchConditionRequest) return;
    seenRequest.current = searchConditionRequest;
    setSearchApplication(undefined);
    setSearchMessage(undefined);
    if (!searchConditionRequest) return;

    const decoded = decodeSearchCondition(searchConditionRequest.definition);
    if (decoded.status === "blocked") {
      setSearchMessage(searchConditionIssueMessage(decoded.issue));
    } else if (selectedProfileId === null || isProfileLoading) {
      setSearchMessage("プロフィールを選択してから検索条件を適用してください。");
    } else if (decoded.value.page !== page) {
      setSearchMessage("検索条件の対象となる一覧を開いてから適用してください。");
    } else {
      setSearchApplication({ source: searchConditionRequest, request: { definition: decoded.value, profileId: selectedProfileId } });
    }
  }, [searchConditionRequest, selectedProfileId, isProfileLoading, page]);

  useLayoutEffect(() => {
    if (searchApplication && searchApplication.request.profileId !== selectedProfileId) {
      setSearchApplication(current => current === searchApplication ? undefined : current);
      if (searchApplication.source === searchConditionRequest) {
        setSearchMessage("プロフィールが切り替わったため、検索条件の適用を取り消しました。");
      }
    }
  }, [searchApplication, searchConditionRequest, selectedProfileId]);

  const settleSearchCondition = useCallback((request: SearchConditionRequest, issue?: SearchConditionIssue) => {
    if (request !== currentRequest) return;
    setSearchApplication(undefined);
    setSearchMessage(issue && searchConditionIssueMessage(issue));
  }, [currentRequest]);

  function cancelSearchApplication() {
    setSearchApplication(undefined);
    setSearchMessage(undefined);
  }

  function navigate(nextPage: AppPage) {
    cancelSearchApplication();
    setDiscoveryFilter(undefined);
    setPage(nextPage);
  }

  function openDiscoveries(filter: DiscoveryInitialFilter) {
    cancelSearchApplication();
    setDiscoveryFilter(filter);
    setPage("discoveries");
  }

  return (
    <AppShell currentPage={page} onNavigate={navigate}>
        {searchMessage && <div className="error-banner" role="alert">{searchMessage}</div>}
        {page === "overview" ? (
          <OverviewPage statsRepository={progressStatsRepository} onOpenDiscoveries={openDiscoveries} />
        ) : page === "profiles" ? (
          <ProfilesPage />
        ) : page === "quests" ? (
          <QuestsPage
            onOpenMasterData={() => navigate("master-data")}
            questRepository={questRepository}
            questProgressRepository={questProgressRepository}
            progressLinkService={progressLinkService}
            searchConditionRequest={currentRequest}
            onSearchConditionSettled={settleSearchCondition}
            masterRevision={masterImport.revision}
            masterImporting={masterImport.pending > 0}
          />
        ) : page === "discoveries" ? (
          <DiscoveriesPage
            onOpenMasterData={() => navigate("master-data")}
            initialFilter={discoveryFilter}
            onNavigationConsumed={consumeDiscoveryNavigation}
            discoveryRepository={discoveryRepository}
            discoveryProgressRepository={discoveryProgressRepository}
            progressLinkService={progressLinkService}
            searchConditionRequest={currentRequest}
            onSearchConditionSettled={settleSearchCondition}
            masterRevision={masterImport.revision}
            masterImporting={masterImport.pending > 0}
          />
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
