import { useCallback, useState } from "react";

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

function App({
  profileRepository = defaultProfileRepository,
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
}: AppProps) {
  const [page, setPage] = useState<AppPage>("profiles");
  const [discoveryFilter, setDiscoveryFilter] = useState<DiscoveryInitialFilter | undefined>();
  const consumeDiscoveryNavigation = useCallback(() => setDiscoveryFilter(undefined), []);

  function navigate(nextPage: AppPage) {
    setDiscoveryFilter(undefined);
    setPage(nextPage);
  }

  function openDiscoveries(filter: DiscoveryInitialFilter) {
    setDiscoveryFilter(filter);
    setPage("discoveries");
  }

  return (
    <ProfileProvider repository={profileRepository}>
      <AppShell currentPage={page} onNavigate={navigate}>
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
          />
        ) : page === "discoveries" ? (
          <DiscoveriesPage
            onOpenMasterData={() => navigate("master-data")}
            initialFilter={discoveryFilter}
            onNavigationConsumed={consumeDiscoveryNavigation}
            discoveryRepository={discoveryRepository}
            discoveryProgressRepository={discoveryProgressRepository}
            progressLinkService={progressLinkService}
          />
        ) : page === "master-data" ? (
          <MasterDataPage
            statusRepository={masterDataStatusRepository}
            importService={masterImportService}
            backupRestoreService={backupRestoreService}
          />
        ) : page === "data-root" ? (
          <DataRootSettingsPage info={dataRootInfo} />
        ) : (
          <PlaceholderPage page={page} />
        )}
      </AppShell>
    </ProfileProvider>
  );
}

export default App;
