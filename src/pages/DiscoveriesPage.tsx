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
  DiscoveryInitialFilter,
} from "../discoveries/types";
import type { DiscoveryProgress, DiscoveryWithRelations } from "../domain/models";
import { useProfiles } from "../profiles/ProfileContext";
import type {
  DiscoveryCompletionResult,
  ProgressLinkServicePort,
} from "../progressLink";

import { useSearchConditionApplication, whenSearchDataReady, type ReadState, type SearchConditionApplicationProps } from "../searchConditions/application";
import { blocked, type SearchConditionDefinition } from "../searchConditions/definition";
import { SearchConditionFeedback } from "../searchConditions/SearchConditionFeedback";
import { discoverySearchOptions, resolveDiscoverySearch } from "../searchConditions/tableState";

interface DiscoveriesPageProps extends SearchConditionApplicationProps {
  onOpenMasterData(): void;
  discoveryRepository: DiscoveryRepositoryPort;
  discoveryProgressRepository: DiscoveryProgressRepositoryPort;
  progressLinkService: ProgressLinkServicePort;
  initialFilter?: DiscoveryInitialFilter;
  onNavigationConsumed?(): void;
}

export function DiscoveriesPage({
  onOpenMasterData,
  discoveryRepository,
  discoveryProgressRepository,
  progressLinkService,
  initialFilter,
  onNavigationConsumed,
  searchConditionRequest,
  onBookmarkCapture,
  onSearchConditionSettled,
  masterRevision = 0,
  masterImporting = false,
}: DiscoveriesPageProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
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

  const reportHold = useReportHold(selectedProfileId, () => {
    const id=selectedProfileId;
    const generation=progressGeneration.current;
    if(id === null) return;
    const masterTicket = ++masterGeneration.current;
    const source = { repository: discoveryRepository, reload: masterReload, revision: masterRevision };
    setMasterRead({ ...source, state: "loading" });
    void Promise.all([discoveryProgressRepository.listByProfile(id),discoveryRepository.listWithRelations()]).then(([saved,master])=>{
      if (masterGeneration.current === masterTicket) {
        setDiscoveries(master);
        setMasterRead({ ...source, state: "ready" });
      }
      if (selectedProfileRef.current === id && progressGeneration.current === generation) {
        setProgressById(new Map(saved.map(p => [p.discoveryId, p])));
      }
    }).catch(() => {
      if (masterGeneration.current === masterTicket) setMasterRead({ ...source, state: "error" });
      if (selectedProfileRef.current === id && progressGeneration.current === generation) setUpdateError("進捗の再取得に失敗しました。再読み込みしてください。");
    });
  }, undefined, masterRevision);
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
    const ticket = ++masterGeneration.current;
    const source = { repository: discoveryRepository, reload: masterReload, revision: masterRevision };
    const isCurrent = () => active && masterGeneration.current === ticket;
    setMasterRead({ ...source, state: "loading" });
    setIsMasterLoading(true);
    setMasterError(null);
    void discoveryRepository
      .listWithRelations()
      .then((loaded) => {
        if (isCurrent()) {
          setDiscoveries(loaded);
          setMasterRead({ ...source, state: "ready" });
        }
      })
      .catch((error: unknown) => {
        console.error("Discovery master load failed", error);
        if (isCurrent()) {
          setMasterError("発見物を読み込めませんでした。");
          setMasterRead({ ...source, state: "error" });
        }
      })
      .finally(() => {
        if (active) setIsMasterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [discoveryRepository, masterReload, masterRevision]);

  useEffect(() => {
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
    setIsProgressLoading(true);
    const source = { repository: discoveryProgressRepository, reload: progressReload, profileId: selectedProfileId };
    const isCurrent = () => progressGeneration.current === generation && selectedProfileRef.current === selectedProfileId;
    void discoveryProgressRepository
      .listByProfile(selectedProfileId)
      .then((progress) => {
        if (isCurrent()) {
          setProgressById(new Map(progress.map((item) => [item.discoveryId, item])));
          setProgressRead({ ...source, state: "ready" });
        }
      })
      .catch((error: unknown) => {
        console.error("Discovery progress load failed", error);
        if (isCurrent()) {
          setProgressError("発見物進捗を読み込めませんでした。");
          setProgressRead({ ...source, state: "error" });
        }
      })
      .finally(() => {
        if (isCurrent()) setIsProgressLoading(false);
      });
  }, [discoveryProgressRepository, progressReload, selectedProfileId]);

  const runUpdate = useCallback(
    async <T,>(
      discoveryId: number,
      operation: (profileId: number) => Promise<T>,
      update: (current: DiscoveryProgress | null, profileId: number, result: T) => DiscoveryProgress | null,
      onSuccess?: (result: T) => void,
    ) => {
      const profileId = selectedProfileRef.current;
      if (profileId === null) return;
      const generation = progressGeneration.current;
      const key = `${profileId}:${discoveryId}`;
      if (pendingUpdatesRef.current.has(key)) return;
      pendingUpdatesRef.current.add(key);
      setPendingUpdates(new Set(pendingUpdatesRef.current));
      setUpdateError(null);
      setUpdateFeedback(null);
      try {
        const result = await operation(profileId);
        if (selectedProfileRef.current === profileId && progressGeneration.current === generation) {
          setProgressById((current) => {
            const next = new Map(current);
            const changed = update(current.get(discoveryId) ?? null, profileId, result);
            if (changed) next.set(discoveryId, changed);
            else next.delete(discoveryId);
            return next;
          });
          onSuccess?.(result);
          void reloadReportStates.current().catch(()=>{if(selectedProfileRef.current === profileId && progressGeneration.current === generation) setUpdateError("報告履歴の再取得に失敗しました。");});
        }
      } catch (error: unknown) {
        console.error("Discovery progress update failed", error);
        if (selectedProfileRef.current === profileId && progressGeneration.current === generation) {
          setUpdateError("発見物進捗を更新できませんでした。現在の状態を再取得します。");
          try {
            const saved=await discoveryProgressRepository.listByProfile(profileId);
            await reloadReportStates.current();
            if (selectedProfileRef.current === profileId && progressGeneration.current === generation) setProgressById(new Map(saved.map(p=>[p.discoveryId,p])));
          } catch { if (selectedProfileRef.current === profileId && progressGeneration.current === generation) setProgressError("進捗の再取得に失敗しました。再読み込みしてください。"); }
        }
      } finally {
        pendingUpdatesRef.current.delete(key);
        setPendingUpdates(new Set(pendingUpdatesRef.current));
      }
    },
    [discoveryProgressRepository],
  );

  const markDiscovered = useCallback(
    async (discoveryId: number, selectedQuestId: number | null) => {
      await runUpdate(
        discoveryId,
        async (profileId) => {
          const result = await progressLinkService.discoverWithLinkedQuest(
            profileId,
            discoveryId,
            selectedQuestId,
          );
          const saved = await discoveryProgressRepository.listByProfile(profileId);
          return { result, saved: saved.find((item) => item.discoveryId === discoveryId) ?? null };
        },
        (_progress, _profileId, { saved }) => saved,
        ({ result }: { result: DiscoveryCompletionResult }) => {
          if (result.questCompleted) {
            setUpdateFeedback(
              "発見物を発見済みにし、関連クエストを達成済みにしました。",
            );
          }
        },
      );
    },
    [discoveryProgressRepository, progressLinkService, runUpdate],
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
  const resolveSearch = useCallback((condition: SearchConditionDefinition) => {
    if (condition.page !== "discoveries") return blocked("invalid", "page");
    const map = condition.filters.mapReacquisition;
    const needsMapState = map === "candidate" || map === "suppressed" || map === "review";
    return whenSearchDataReady([
      ["master", searchMasterRead],
      ["progress", searchProgressRead],
      ["unreportedBreakdown", condition.filters.unreportedBreakdown ? reportHold.summaryReadState : "ready"],
      ["mapReacquisition", needsMapState ? reportHold.summaryReadState : "ready"],
    ], () => rows.length ? resolveDiscoverySearch(condition, searchOptions) : blocked("unavailable", "master"));
  }, [rows.length, searchMasterRead, searchProgressRead, reportHold.summaryReadState, searchOptions]);
  const searchCondition = useSearchConditionApplication(selectedProfileId, { searchConditionRequest, onSearchConditionSettled }, resolveSearch);

  if (isProfileLoading) return <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>;
  if (selectedProfileId === null) {
    return <div className="state-panel empty-state"><h2>発見物進捗を表示するプロフィールを選択してください</h2><p>プロフィール画面でプロフィールを作成または選択してください。</p></div>;
  }

  return (
    <section className="workspace-page" aria-labelledby="discoveries-title">
      <div className="page-heading"><div><p className="page-eyebrow">進捗管理</p><h2 id="discoveries-title">発見物</h2><p>発見・報告・カード所有の状態を個別に管理します。</p></div></div>
      <ReportHoldFeedback controller={reportHold} />
      <ReportHoldDialogs controller={reportHold} />
      {masterError && <ErrorBanner message={masterError} onRetry={() => setMasterReload((value) => value + 1)} />}
      {progressError && <ErrorBanner message={progressError} onRetry={() => setProgressReload((value) => value + 1)} />}
      {updateError && <div className="error-banner" role="alert">{updateError}</div>}
      {updateFeedback && <div className="progress-feedback" role="status">{updateFeedback}</div>}
      <SearchConditionFeedback application={searchCondition} />
      {isMasterLoading || isProgressLoading ? (
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
          searchCondition={searchCondition}
          searchOptions={searchOptions}
          onBookmarkCapture={searchMasterRead === "ready" && searchProgressRead === "ready" ? onBookmarkCapture : undefined}
          historyReadState={reportHold.summaryReadState}
          reportHold={reportHold}
          rows={rows}
          initialFilter={initialFilter}
          onNavigationConsumed={onNavigationConsumed}
          paginationResetKey={selectedProfileId}
          onToggleDiscovered={toggleDiscovered}
          onSetReported={setReported}
          onSetCardOwned={setCardOwned}
        />
      )}
      {questSelection && (
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
