import { useReportHold } from "../discoveries/useReportHold";
import { ReportHoldDialogs, ReportHoldFeedback } from "../components/discoveries/ReportHoldControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DiscoveryTable } from "../components/discoveries/DiscoveryTable";
import { RelatedQuestDialog } from "../components/discoveries/RelatedQuestDialog";
import { discoveryCapabilities } from "../discoveries/capabilities";
import type {
  DiscoveryProgressRepositoryPort,
  DiscoveryRepositoryPort,
  DiscoveryRowViewModel,
} from "../discoveries/types";
import type { DiscoveryProgress, DiscoveryWithRelations } from "../domain/models";
import { useProfiles } from "../profiles/ProfileContext";
import type {
  DiscoveryCompletionResult,
  ProgressLinkServicePort,
} from "../progressLink";

import { useCanFollowSearchRetry, useSearchConditionApplication, whenSearchDataReady, type ReadState, type SearchConditionApplicationProps, type SearchConditionRequest } from "../searchConditions/application";
import { blocked, type SearchConditionDefinition } from "../searchConditions/definition";
import { SearchConditionFeedback } from "../searchConditions/SearchConditionFeedback";
import { discoverySearchOptions, resolveDiscoverySearch } from "../searchConditions/tableState";
import { useSearchTableState } from "../searchConditions/useSearchTableState";
import type { ProgressReadKind, WorkspaceReads } from "../workspaceReads/WorkspaceReads";
import { useWorkspaceReadScope } from "../workspaceReads/useWorkspaceReadScope";

interface DiscoveriesPageProps extends SearchConditionApplicationProps {
  workspaceReads?: WorkspaceReads;
  onOpenMasterData(): void;
  discoveryRepository: DiscoveryRepositoryPort;
  discoveryProgressRepository: DiscoveryProgressRepositoryPort;
  progressLinkService: ProgressLinkServicePort;
}

export function DiscoveriesPage({
  onOpenMasterData,
  discoveryRepository,
  discoveryProgressRepository,
  progressLinkService,
  searchConditionRequest,
  workspaceTab,
  workspaceReads,
  staged,
  onBookmarkCapture,
  onSearchConditionSettled,
  masterRevision = 0,
  masterImporting = false,
}: DiscoveriesPageProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const readScope = useWorkspaceReadScope(workspaceReads, selectedProfileId);
  const { reads, owner } = readScope;
  const canFollowRetry = useCanFollowSearchRetry(selectedProfileId, { staged, searchConditionRequest, workspaceTab, masterRevision });
  const [discoveries, setDiscoveries] = useState<DiscoveryWithRelations[]>([]);
  const [progressById, setProgressById] = useState<Map<number, DiscoveryProgress>>(new Map());
  const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());
  const [isMasterLoading, setIsMasterLoading] = useState(true);
  const [isProgressLoading, setIsProgressLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null);
  const [questSelection, setQuestSelection] = useState<{
    discoveryId: number;
    discoveryName: string;
    quests: Array<{ id: number; title: string }>;
  } | null>(null);
  const [masterReload, setMasterReload] = useState(0);
  const [progressReload, setProgressReload] = useState(0);
  const [masterRead, setMasterRead] = useState<{ repository: DiscoveryRepositoryPort; reload: number; revision: number; state: ReadState }>();
  const [progressRead, setProgressRead] = useState<{
    repository: DiscoveryProgressRepositoryPort; reload: number; profileId: number; state: ReadState;
  }>();
  const progressGeneration = useRef(0);
  const selectedProfileRef = useRef(selectedProfileId);
  const masterGeneration = useRef(0);
  const pendingUpdatesRef = useRef<Set<string>>(new Set());
  const loadMaster = useCallback((fresh = false) => reads.read("discoveryMaster", discoveryRepository, null,
    () => discoveryRepository.listWithRelations(), { fresh, masterRevision }), [discoveryRepository, reads, masterRevision]);
  const loadProgress = useCallback((id: number, fresh = false, active?: () => boolean) =>
    reads.read("discoveryProgress", discoveryProgressRepository, id,
      async () => new Map((await discoveryProgressRepository.listByProfile(id)).map(item => [item.discoveryId, item])),
      { fresh, active }), [discoveryProgressRepository, reads]);

  useEffect(() => reads.subscribe(change => {
    if (change.owner === owner || change.profileId !== selectedProfileRef.current || !change.kinds.includes("discoveryProgress")) return;
    ++progressGeneration.current;
    setProgressReload(value => value + 1);
  }), [reads, owner]);

  const reportHold = useReportHold(selectedProfileId, reason => {
    const id=selectedProfileId;
    const generation=progressGeneration.current;
    if (id === null || !owner.active) return;
    const master = reason === "progress" ? undefined : loadMaster(true);
    const masterTicket = master ? ++masterGeneration.current : undefined;
    const source = { repository: discoveryRepository, reload: masterReload, revision: masterRevision };
    const isCurrent = () => owner.active && selectedProfileRef.current === id && progressGeneration.current === generation;
    const progress = loadProgress(id, reason !== "progress", isCurrent);
    if (master) setMasterRead({ ...source, state: "loading" });
    void Promise.all([progress.promise, master?.promise]).then(([saved,loaded])=>{
      if (owner.active && loaded && master?.isCurrent() && masterGeneration.current === masterTicket) {
        setDiscoveries(loaded);
        setMasterRead({ ...source, state: "ready" });
      }
      if (isCurrent() && progress.isCurrent()) {
        setProgressById(saved);
      }
    }).catch(() => {
      if (owner.active && master?.isCurrent() && masterGeneration.current === masterTicket) setMasterRead({ ...source, state: "error" });
      if (isCurrent()) setUpdateError("進捗の再取得に失敗しました。再読み込みしてください。");
    });
  }, undefined, masterRevision, readScope);
  const reloadReportStates = useRef(reportHold.reload);
  reloadReportStates.current = reportHold.reload;
  selectedProfileRef.current = selectedProfileId;

  useEffect(() => {
    if (updateFeedback === null) return;
    const timeout = window.setTimeout(() => setUpdateFeedback(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [updateFeedback]);

  useEffect(() => {
    let active = true;
    const source = { repository: discoveryRepository, reload: masterReload, revision: masterRevision };
    let latest: ReturnType<typeof loadMaster> | undefined;
    const load = (read: typeof latest, retry = false) => {
      latest = read;
      const ticket = ++masterGeneration.current;
      setMasterRead({ ...source, state: "loading" });
      setIsMasterLoading(true);
      setMasterError(null);
      if (!read) return;
      const isCurrent = () => active && owner.active && read.isCurrent() && masterGeneration.current === ticket && (!retry || canFollowRetry(masterRevision));
      void read.promise
        .then((loaded) => {
          if (!isCurrent()) return;
          setDiscoveries(loaded);
          setMasterRead({ ...source, state: "ready" });
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          console.error("Discovery master load failed", error);
          setMasterError("発見物を読み込めませんでした。");
          setMasterRead({ ...source, state: "error" });
        })
        .finally(() => {
          if (active && latest === read) setIsMasterLoading(false);
        });
    };
    load(loadMaster());
    const unsubscribe = reads.subscribeRetry("discoveryMaster", discoveryRepository, null, (read: typeof latest) => {
      if (canFollowRetry(masterRevision)) load(read, true);
    }, masterRevision);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [discoveryRepository, loadMaster, masterReload, masterRevision, owner, reads, canFollowRetry]);

  useEffect(() => {
    let active = true;
    const generation = ++progressGeneration.current;
    setProgressById(new Map());
    setProgressError(null);
    setUpdateError(null);
    setUpdateFeedback(null);
    setQuestSelection(null);
    if (selectedProfileId === null) {
      setIsProgressLoading(false);
      return;
    }
    const profileId = selectedProfileId;
    const source = { repository: discoveryProgressRepository, reload: progressReload, profileId };
    const isActive = () => active && owner.active && progressGeneration.current === generation && selectedProfileRef.current === profileId;
    let latest: ReturnType<typeof loadProgress> | undefined;
    const load = (read: typeof latest, retry = false) => {
      latest = read;
      setIsProgressLoading(true);
      setProgressRead({ ...source, state: "loading" });
      if (retry) setProgressError(null);
      if (!read) return;
      const isCurrent = () => isActive() && latest === read && read.isCurrent() && (!retry || canFollowRetry());
      void read.promise
        .then((progress) => {
          if (!isCurrent()) return;
          setProgressById(progress);
          setProgressRead({ ...source, state: "ready" });
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          console.error("Discovery progress load failed", error);
          setProgressError("発見物進捗を読み込めませんでした。");
          setProgressRead({ ...source, state: "error" });
        })
        .finally(() => {
          if (isActive() && latest === read) setIsProgressLoading(false);
        });
    };
    load(loadProgress(profileId, false, isActive));
    const unsubscribe = reads.subscribeRetry("discoveryProgress", discoveryProgressRepository, profileId, (read: typeof latest) => {
      if (isActive() && canFollowRetry()) load(read, true);
    });
    return () => { active = false; unsubscribe(); };
  }, [discoveryProgressRepository, loadProgress, progressReload, selectedProfileId, owner, reads, canFollowRetry]);

  const runUpdate = useCallback(
    async <T,>(
      discoveryId: number,
      operation: (profileId: number) => Promise<T>,
      update: ((current: DiscoveryProgress | null) => DiscoveryProgress | null) | undefined,
      onSuccess?: (result: T) => void,
      linksQuest = false,
    ) => {
      const profileId = selectedProfileRef.current;
      if (profileId === null || !owner.active) return;
      const generation = progressGeneration.current;
      const isCurrent = () => owner.active && selectedProfileRef.current === profileId && progressGeneration.current === generation;
      const key = `${profileId}:${discoveryId}`;
      if (pendingUpdatesRef.current.has(key)) return;
      pendingUpdatesRef.current.add(key);
      setPendingUpdates(new Set(pendingUpdatesRef.current));
      setUpdateError(null);
      setUpdateFeedback(null);
      const affected: ProgressReadKind[] = ["discoveryProgress", "report"];
      if (linksQuest) affected.push("questProgress");
      try {
        const result = await reads.write(owner, profileId, affected, () => operation(profileId));
        if (isCurrent()) {
          if (update) {
            setProgressById((current) => {
              const next = new Map(current);
              const changed = update(current.get(discoveryId) ?? null);
              if (changed) next.set(discoveryId, changed);
              else next.delete(discoveryId);
              return next;
            });
          } else {
            const read = loadProgress(profileId, false, isCurrent);
            const saved = await read.promise;
            if (!isCurrent()) return;
            if (read.isCurrent()) setProgressById(saved);
            else setProgressReload(value => value + 1);
          }
          onSuccess?.(result);
          void reloadReportStates.current(false).catch(()=>{if(isCurrent()) setUpdateError("報告履歴の再取得に失敗しました。");});
        }
      } catch (error: unknown) {
        console.error("Discovery progress update failed", error);
        if (isCurrent()) {
          setUpdateError("発見物進捗を更新できませんでした。現在の状態を再取得します。");
          const read = loadProgress(profileId, false, isCurrent);
          try {
            const saved = await read.promise;
            if (isCurrent()) await reloadReportStates.current(false);
            if (isCurrent()) {
              if (read.isCurrent()) setProgressById(saved);
              else setProgressReload(value => value + 1);
            }
          } catch { if (isCurrent() && read.isCurrent()) setProgressError("進捗の再取得に失敗しました。再読み込みしてください。"); }
        }
      } finally {
        pendingUpdatesRef.current.delete(key);
        if (owner.active) setPendingUpdates(new Set(pendingUpdatesRef.current));
      }
    },
    [loadProgress, reads, owner],
  );

  const markDiscovered = useCallback(
    async (discoveryId: number, selectedQuestId: number | null) => {
      await runUpdate(
        discoveryId,
        (profileId) => progressLinkService.discoverWithLinkedQuest(profileId, discoveryId, selectedQuestId),
        undefined,
        (result: DiscoveryCompletionResult) => {
          if (result.questCompleted) {
            setUpdateFeedback(
              "発見物を発見済みにし、関連クエストを達成済みにしました。",
            );
          }
        },
        true,
      );
    },
    [progressLinkService, runUpdate],
  );

  const toggleDiscovered = useCallback(
    async (discoveryId: number, discovered: boolean) => {
      const current = progressById.get(discoveryId) ?? null;
      if (discovered) {
        const memoWarning = current?.memo
          ? "\nこの発見物のメモも削除されます。"
          : "\nこの発見物に保存されたメモがある場合は削除されます。";
        if (!window.confirm(`未発見に戻しますか？現在の発見・報告・カード所有・維持設定を削除します。クエスト達成と過去の報告履歴・旧算入資格は保持します。${memoWarning}`)) return;
      } else {
        const target = discoveries.find((item) => item.discovery.id === discoveryId);
        if (target && target.relatedQuests.length > 1) {
          setQuestSelection({
            discoveryId,
            discoveryName: target.discovery.name,
            quests: target.relatedQuests,
          });
          return;
        }
        await markDiscovered(discoveryId, null);
        return;
      }
      await runUpdate(
        discoveryId,
        (profileId) => discoveryProgressRepository.markUndiscovered(profileId, discoveryId),
        () => null,
      );
    },
    [discoveries, discoveryProgressRepository, markDiscovered, progressById, runUpdate],
  );

  const setReported = useCallback(
    async (discoveryId: number, reported: boolean) => {
      if (!reported && !window.confirm("再発見後の未報告状態を記録します。過去の報告履歴と旧算入資格を保持します。")) return;
      return runUpdate(
        discoveryId,
        (profileId) => discoveryProgressRepository.setReported(profileId, discoveryId, reported),
        (progress) => (progress ? { ...progress, reported, updatedAt: new Date().toISOString() } : null),
      );
    },
    [discoveryProgressRepository, runUpdate],
  );

  const setCardOwned = useCallback(
    async (discoveryId: number, cardOwned: boolean) =>
      runUpdate(
        discoveryId,
        (profileId) => discoveryProgressRepository.setCardOwned(profileId, discoveryId, cardOwned),
        (progress) => (progress ? { ...progress, cardOwned, updatedAt: new Date().toISOString() } : null),
      ),
    [discoveryProgressRepository, runUpdate],
  );

  const rows = useMemo<DiscoveryRowViewModel[]>(
    () =>
      discoveries.filter(({ discovery }) => discovery.isActive).map(({ discovery, category, relatedQuests, automaticReporting, mapTarget }) => {
        const progress = progressById.get(discovery.id) ?? null;
        const capabilities = discoveryCapabilities(category);
        const effectiveReported = capabilities.canReport && progress !== null && (automaticReporting || progress.reported);
        const reporting = reportHold.summaries.get(discovery.id);
        return {
          unreportedHistoryReady: reportHold.summaryReadState === "ready" && reporting !== undefined,
          firstReportStatus: reporting?.firstReportStatus,
          historyPresent: reporting ? reporting.historyUpdatedAt !== null : undefined,
          legacyMeritCredit: Boolean(reporting?.legacyMeritCredit),
          mapTarget,
          mapRelated: Boolean(reportHold.summaries.get(discovery.id)?.mapRelated),
          mapNeedsReview: Boolean(reportHold.summaries.get(discovery.id)?.mapNeedsReview),
          automaticReporting: capabilities.canReport && automaticReporting,
          effectiveReported,
          id: discovery.id,
          name: discovery.name,
          description: discovery.description,
          notes: discovery.notes,
          category,
          rank: discovery.rank,
          era: discovery.era,
          points: discovery.points,
          difficulty: discovery.difficulty,
          experience: discovery.experience,
          relatedQuests,
          ...capabilities,
          status: progress === null ? "undiscovered" : effectiveReported ? "reported" : "unreported",
          progress,
          updating:
            selectedProfileId !== null && (pendingUpdates.has(`${selectedProfileId}:${discovery.id}`) || reportHold.busy || (reportHold.dialog !== null || reportHold.selection !== null)),
        };
      }),
    [discoveries, pendingUpdates, progressById, selectedProfileId, reportHold.busy, reportHold.dialog, reportHold.selection, reportHold.summaries, reportHold.summaryReadState],
  );

  const searchOptions = useMemo(() => discoverySearchOptions(rows), [rows]);
  const searchMasterRead = !masterImporting && masterRead?.repository === discoveryRepository && masterRead.reload === masterReload
    && masterRead.revision === masterRevision ? masterRead.state : "loading";
  const searchProgressRead = !isProfileLoading && progressRead?.profileId === selectedProfileId
    && progressRead.repository === discoveryProgressRepository && progressRead.reload === progressReload
    ? progressRead.state : "loading";
  const resolveSearch = useCallback((condition: SearchConditionDefinition, drilldown?: SearchConditionRequest["discoveryDrilldown"]) => {
    if (condition.page !== "discoveries") return blocked("invalid", "page");
    const map = condition.filters.mapReacquisition;
    const needsMapState = map === "candidate" || map === "suppressed" || map === "review";
    return whenSearchDataReady([
      ["master", searchMasterRead],
      ["progress", searchProgressRead],
      ["unreportedBreakdown", condition.filters.unreportedBreakdown ? reportHold.summaryReadState : "ready"],
      ["mapReacquisition", needsMapState ? reportHold.summaryReadState : "ready"],
    ], () => {
      if (!rows.length && !drilldown) return blocked("unavailable", "master");
      const options = drilldown?.categoryId === undefined ? searchOptions : {
        ...searchOptions, categories: searchOptions.categories.filter(category => category.id === drilldown.categoryId),
      };
      return resolveDiscoverySearch(condition, options);
    });
  }, [rows.length, searchMasterRead, searchProgressRead, reportHold.summaryReadState, searchOptions]);
  const tableState = useSearchTableState(workspaceTab);
  const searchCondition = useSearchConditionApplication(selectedProfileId,
    { workspaceTab, staged, searchConditionRequest, onSearchConditionSettled }, resolveSearch, tableState);

  if (staged) return null;
  if (isProfileLoading) return <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>;
  if (selectedProfileId === null) {
    return <div className="state-panel empty-state"><h2>発見物進捗を表示するプロフィールを選択してください</h2><p>プロフィール画面でプロフィールを作成または選択してください。</p></div>;
  }

  return (
    <section className="workspace-page" aria-labelledby="discoveries-title">
      <h2 className="workspace-page-title" id="discoveries-title">発見物</h2>
      <ReportHoldFeedback controller={reportHold} />
      <ReportHoldDialogs controller={reportHold} />
      {masterError && <ErrorBanner message={masterError} onRetry={() => {
        reads.invalidateRead("discoveryMaster", discoveryRepository, null);
        setMasterReload(value => value + 1);
      }} />}
      {progressError && searchProgressRead !== "loading" && <ErrorBanner message={progressError} onRetry={() => {
        reads.invalidateRead("discoveryProgress", discoveryProgressRepository, selectedProfileId);
        setProgressReload(value => value + 1);
      }} />}
      {updateError && <div className="error-banner" role="alert">{updateError}</div>}
      {updateFeedback && <div className="progress-feedback" role="status">{updateFeedback}</div>}
      <SearchConditionFeedback application={searchCondition} />
      {isMasterLoading || isProgressLoading || searchProgressRead === "loading" ? (
        <div className="state-panel" role="status">発見物を読み込んでいます…</div>
      ) : masterError || progressError ? null : discoveries.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>発見物のマスターデータがありません</h3>
          <p>「マスターデータ」画面で発見物情報を取り込むと、発見物の一覧を表示できます。</p>
          <button type="button" className="button primary" onClick={onOpenMasterData}>マスターデータを開く</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>表示できる有効な発見物がありません</h3>
          <p>「マスターデータ」画面で登録状況を確認してください。</p>
        </div>
      ) : (
        <DiscoveryTable
          key={searchCondition.resetKey}
          tableState={tableState}
          searchCondition={searchCondition}
          searchOptions={searchOptions}
          onBookmarkCapture={searchMasterRead === "ready" && searchProgressRead === "ready" ? onBookmarkCapture : undefined}
          historyReadState={reportHold.summaryReadState}
          reportHold={reportHold}
          rows={rows}
          paginationResetKey={selectedProfileId}
          onToggleDiscovered={toggleDiscovered}
          onSetReported={setReported}
          onSetCardOwned={setCardOwned}
        />
      )}
      {questSelection && searchProgressRead === "ready" && (
        <RelatedQuestDialog
          discoveryName={questSelection.discoveryName}
          quests={questSelection.quests}
          onCancel={() => setQuestSelection(null)}
          onConfirm={(selectedQuestId) => {
            const discoveryId = questSelection.discoveryId;
            setQuestSelection(null);
            void markDiscovered(discoveryId, selectedQuestId);
          }}
        />
      )}
    </section>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className="error-banner" role="alert"><span>{message}</span><button type="button" className="button secondary" onClick={onRetry}>再読み込み</button></div>;
}
