import { useReportHold } from "../discoveries/useReportHold";
import { ReportHoldDialogs, ReportHoldFeedback } from "../components/discoveries/ReportHoldControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QuestTable } from "../components/quests/QuestTable";
import type { QuestWithDiscoveries } from "../domain/models";
import { useProfiles } from "../profiles/ProfileContext";
import type { ProgressLinkServicePort } from "../progressLink";
import { derivePrerequisiteStatuses, type QuestDependency } from "../quests/prerequisites";
import { resolveDirectPrerequisites } from "../quests/directPrerequisites";
import { buildPrerequisiteReviewIndex, derivePrerequisiteProgressReview, type PrerequisiteProgressReviewState } from "../quests/prerequisiteProgressReview";
import type {
  QuestProgressRepositoryPort,
  QuestRepositoryPort,
  QuestRowViewModel,
} from "../quests/types";

interface QuestsPageProps {
  onOpenMasterData(): void;
  questRepository: QuestRepositoryPort;
  questProgressRepository: QuestProgressRepositoryPort;
  progressLinkService: ProgressLinkServicePort;
}

interface MasterSnapshot {
  quests: QuestWithDiscoveries[];
  dependencies: QuestDependency[];
  generation: number;
  reload: number;
  repository: QuestRepositoryPort;
}
interface CompletionSnapshot {
  ids: Set<number>;
  profileId: number;
  epoch: number;
  reload: number;
  repository: QuestProgressRepositoryPort;
}
const EMPTY_QUESTS: QuestWithDiscoveries[] = [];
const EMPTY_DEPENDENCIES: QuestDependency[] = [];
const EMPTY_COMPLETED = new Set<number>();

export function QuestsPage({
  onOpenMasterData,
  questRepository,
  questProgressRepository,
  progressLinkService,
}: QuestsPageProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const [masterSnapshot, setMasterSnapshot] = useState<MasterSnapshot | null>(null);
  const [completionSnapshot, setCompletionSnapshot] = useState<CompletionSnapshot | null>(null);
  const quests = masterSnapshot?.quests ?? EMPTY_QUESTS;
  const dependencies = masterSnapshot?.dependencies ?? EMPTY_DEPENDENCIES;
  const completedQuestIds = completionSnapshot?.ids ?? EMPTY_COMPLETED;
  const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());
  const [isMasterLoading, setIsMasterLoading] = useState(true);
  const [isProgressLoading, setIsProgressLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateDiagnostic, setUpdateDiagnostic] = useState<string | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null);
  const [masterReload, setMasterReload] = useState(0);
  const [progressReload, setProgressReload] = useState(0);
  const progressGeneration = useRef(0);
  const selectedProfileRef = useRef(selectedProfileId);
  const pendingUpdatesRef = useRef<Set<string>>(new Set());
  const masterGeneration = useRef(0);
  const progressReadGeneration = useRef(0);
  const writeRevision = useRef(0);
  const [progressNeedsRefresh, setProgressNeedsRefresh] = useState(false);
  const [masterRead, setMasterRead] = useState<{ generation: number; state: "loading" | "ready" | "error" } | null>(null);
  selectedProfileRef.current = selectedProfileId;
  const pendingForProfile = selectedProfileId !== null && [...pendingUpdates].some(key => key.startsWith(`${selectedProfileId}:`));
  const loadMasterPair = useCallback(() => Promise.all([
    questRepository.listWithDiscoveries(), questRepository.listDependencies(),
  ]), [questRepository]);

  const reportHold = useReportHold(selectedProfileId, () => {
    const id = selectedProfileId;
    const generation = progressGeneration.current;
    if (id === null) return;
    const masterTicket = ++masterGeneration.current;
    const progressTicket = ++progressReadGeneration.current;
    const revision = writeRevision.current;
    setMasterRead({ generation: masterTicket, state: "loading" });
    void Promise.all([questProgressRepository.listCompletedQuestIds(id), loadMasterPair()]).then(([ids, [loaded, loadedDependencies]]) => {
      if (masterGeneration.current === masterTicket) {
        setMasterSnapshot({ quests: loaded, dependencies: loadedDependencies, generation: masterTicket, reload: masterReload, repository: questRepository });
        setMasterRead({ generation: masterTicket, state: "ready" });
      }
      if (selectedProfileRef.current !== id || progressGeneration.current !== generation) return;
      if (progressReadGeneration.current !== progressTicket) return;
      if (writeRevision.current === revision
        && ![...pendingUpdatesRef.current].some(key => key.startsWith(`${id}:`))) {
        setCompletionSnapshot({ ids: new Set(ids), profileId: id, epoch: generation, reload: progressReload, repository: questProgressRepository });
      } else {
        setProgressNeedsRefresh(true);
      }
    }).catch(() => {
      if (masterGeneration.current === masterTicket) setMasterRead({ generation: masterTicket, state: "error" });
      if (selectedProfileRef.current === id && progressGeneration.current === generation && progressReadGeneration.current === progressTicket) setUpdateError("進捗の再取得に失敗しました。再読み込みしてください。");
    });
  });
  useEffect(() => {
    if (!progressNeedsRefresh || pendingForProfile || reportHold.busy) return;
    setProgressNeedsRefresh(false);
    setProgressReload(value => value + 1);
  }, [progressNeedsRefresh, pendingForProfile, reportHold.busy]);

  useEffect(() => {
    if (updateFeedback === null) return;
    const timeout = window.setTimeout(() => setUpdateFeedback(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [updateFeedback]);

  useEffect(() => {
    let active = true;
    const generation = ++masterGeneration.current;
    setMasterRead({ generation, state: "loading" });
    setIsMasterLoading(true);
    setMasterError(null);
    void loadMasterPair()
      .then(([loaded, loadedDependencies]) => {
        if (active && masterGeneration.current === generation) {
          setMasterSnapshot({ quests: loaded, dependencies: loadedDependencies, generation, reload: masterReload, repository: questRepository });
          setMasterRead({ generation, state: "ready" });
        }
      })
      .catch((error: unknown) => {
        console.error("Quest master load failed", error);
        if (active && masterGeneration.current === generation) {
          setMasterError("クエストを読み込めませんでした。");
          setMasterRead({ generation, state: "error" });
        }
      })
      .finally(() => {
        if (active) setIsMasterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [masterReload, questRepository, loadMasterPair]);

  useEffect(() => {
    let active = true;
    const generation = ++progressGeneration.current;
    const ticket = ++progressReadGeneration.current;
    const revision = writeRevision.current;
    setCompletionSnapshot(null);
    setProgressNeedsRefresh(false);
    setProgressError(null);
    setUpdateError(null);
    setUpdateDiagnostic(null);
    setUpdateFeedback(null);
    if (selectedProfileId === null) {
      setIsProgressLoading(false);
      return;
    }

    setIsProgressLoading(true);
    void questProgressRepository
      .listCompletedQuestIds(selectedProfileId)
      .then((ids) => {
        if (active && progressGeneration.current === generation && selectedProfileRef.current === selectedProfileId && progressReadGeneration.current === ticket) {
          if (writeRevision.current !== revision || [...pendingUpdatesRef.current].some(key => key.startsWith(`${selectedProfileId}:`))) {
            setProgressNeedsRefresh(true);
          } else {
            setCompletionSnapshot({ ids: new Set(ids), profileId: selectedProfileId, epoch: generation, reload: progressReload, repository: questProgressRepository });
          }
        }
      })
      .catch((error: unknown) => {
        console.error("Quest progress load failed", error);
        if (active && progressGeneration.current === generation && progressReadGeneration.current === ticket) {
          setProgressError("クエスト進捗を読み込めませんでした。");
        }
      })
      .finally(() => {
        if (active && progressGeneration.current === generation) {
          setIsProgressLoading(false);
        }
      });
    return () => { active = false; };
  }, [progressReload, questProgressRepository, selectedProfileId]);

  const toggleCompletion = useCallback(
    async (questId: number, completed: boolean) => {
      const profileId = selectedProfileRef.current;
      if (profileId === null) return;
      const generation = progressGeneration.current;
      const updateKey = `${profileId}:${questId}`;
      if (pendingUpdatesRef.current.has(updateKey)) return;

      ++writeRevision.current;
      pendingUpdatesRef.current.add(updateKey);
      setPendingUpdates(new Set(pendingUpdatesRef.current));
      setUpdateError(null);
      setUpdateDiagnostic(null);
      setUpdateFeedback(null);
      const started = performance.now();
      const operation = completed ? "cancel" : "complete";
      try {
        if (completed) {
          await questProgressRepository.markIncomplete(profileId, questId);
        } else {
          const result = await progressLinkService.completeQuestWithLinkedDiscoveries(
            profileId,
            questId,
          );
          if (
            selectedProfileRef.current === profileId && progressGeneration.current === generation &&
            result.discoveriesCreated > 0
          ) {
            setUpdateFeedback(
              `クエストを達成済みにし、関連する発見物 ${result.discoveriesCreated}件を発見済みにしました。`,
            );
          }
        }
        if (selectedProfileRef.current === profileId && progressGeneration.current === generation) {
          ++writeRevision.current;
          void reportHold.reload().catch(()=>{if(selectedProfileRef.current === profileId && progressGeneration.current === generation) setUpdateError("地図状態の再取得に失敗しました。");});
          setCompletionSnapshot((current) => {
            if (!current || current.profileId !== profileId || current.epoch !== generation) return current;
            const next = new Set(current.ids);
            if (completed) next.delete(questId);
            else next.add(questId);
            return { ...current, ids: next };
          });
        }
      } catch (error: unknown) {
        const diagnostic = `${operation} / ${classifyQuestUpdateError(error)} / ${Math.round(performance.now()-started)}ms`;
        console.error("Quest progress update failed", diagnostic);
        if (selectedProfileRef.current === profileId && progressGeneration.current === generation) {
          const revision = ++writeRevision.current;
          const ticket = ++progressReadGeneration.current;
          setUpdateError("達成状態を更新できませんでした。現在の状態を再取得します。");
          setUpdateDiagnostic(diagnostic);
          const recoveryStarted=performance.now();
          try {
            const ids=await questProgressRepository.listCompletedQuestIds(profileId);
            await reportHold.reload();
            if (selectedProfileRef.current === profileId && progressGeneration.current === generation) {
              if (writeRevision.current === revision && progressReadGeneration.current === ticket) {
                setCompletionSnapshot({ ids: new Set(ids), profileId, epoch: generation, reload: progressReload, repository: questProgressRepository });
              } else {
                setProgressNeedsRefresh(true);
              }
            }
            if(selectedProfileRef.current === profileId && progressGeneration.current === generation) setUpdateDiagnostic(`${diagnostic} / reload:ok:${Math.round(performance.now()-recoveryStarted)}ms`);
          } catch (recoveryError: unknown) {if(selectedProfileRef.current === profileId && progressGeneration.current === generation) {
            setProgressError("進捗の再取得に失敗しました。再読み込みしてください。");
            setUpdateDiagnostic(`${diagnostic} / reload:${classifyQuestUpdateError(recoveryError)}:${Math.round(performance.now()-recoveryStarted)}ms`);
          }}
        }
      } finally {
        pendingUpdatesRef.current.delete(updateKey);
        setPendingUpdates(new Set(pendingUpdatesRef.current));
        if (selectedProfileRef.current === profileId && progressGeneration.current !== generation) setProgressNeedsRefresh(true);
      }
    },
    [progressLinkService, questProgressRepository, reportHold.reload, progressReload],
  );

  const statuses = useMemo(() => derivePrerequisiteStatuses(quests.map(({ quest }) => quest), dependencies, completedQuestIds),
    [quests, dependencies, completedQuestIds]);
  const reviewIndex = useMemo(() => buildPrerequisiteReviewIndex(quests.map(({ quest }) => quest), dependencies), [quests, dependencies]);
  const candidates = useMemo(() => derivePrerequisiteProgressReview(reviewIndex, completedQuestIds, statuses), [reviewIndex, completedQuestIds, statuses]);
  const completionMatches = completionSnapshot?.profileId === selectedProfileId && completionSnapshot?.epoch === progressGeneration.current
    && completionSnapshot?.reload === progressReload && completionSnapshot?.repository === questProgressRepository;
  const masterMatches = masterSnapshot?.repository === questRepository && masterSnapshot?.reload === masterReload
    && masterRead?.generation === masterSnapshot?.generation && masterRead?.state === "ready";
  const progressReview = useMemo<PrerequisiteProgressReviewState>(() => {
    if (masterError || progressError || masterRead?.state === "error" || reportHold.summaryReadState === "error") return { status: "error" };
    if (!completionMatches || !masterMatches || isMasterLoading || isProgressLoading || progressNeedsRefresh || isProfileLoading) return { status: "loading" };
    if (pendingForProfile || reportHold.busy || reportHold.summaryReadState !== "ready") return { status: "updating" };
    return { status: "ready", candidates };
  }, [masterError, progressError, masterRead, reportHold.summaryReadState, completionMatches, masterMatches,
    isMasterLoading, isProgressLoading, progressNeedsRefresh, isProfileLoading, pendingForProfile, reportHold.busy, candidates]);
  const reloadReview = () => {
    setMasterReload(value => value + 1);
    setProgressReload(value => value + 1);
    void reportHold.reload().catch(() => undefined);
  };
  const directPrerequisites = useMemo(
    () => resolveDirectPrerequisites(quests, dependencies),
    [quests, dependencies],
  );
  const rows = useMemo<QuestRowViewModel[]>(() => {
    return quests.map(({ quest, discoveries, offerCities, requiredSkillsNormalized }) => ({
        id: quest.id,
        title: quest.title,
        notes: quest.notes,
        difficulty: quest.difficulty,
        offerMethod: quest.offerMethod,
        offerCity: quest.offerCity,
        offerCities: offerCities.map((city) => city.cityName),
        requiredSkills: quest.requiredSkills,
        requiredSkillNames: requiredSkillsNormalized.map((skill) => skill.skillName),
        requiredSkillsNormalized: requiredSkillsNormalized.map(({ skillName, requiredRank }) => ({
          skillName,
          requiredRank,
        })),
        discoveries,
        mapActive: quest.isActive,
        completed: completedQuestIds.has(quest.id),
        prerequisiteStatus: statuses.get(quest.id) ?? "UNKNOWN",
        directPrerequisites: directPrerequisites.get(quest.id) ?? [],
        updating:
          selectedProfileId !== null &&
          (pendingUpdates.has(`${selectedProfileId}:${quest.id}`) || reportHold.busy || (reportHold.dialog !== null || reportHold.selection !== null)),
      }));
  }, [completedQuestIds, statuses, directPrerequisites, pendingUpdates, quests, selectedProfileId, reportHold.busy, reportHold.dialog, reportHold.selection, reportHold.summaries]);

  if (isProfileLoading) {
    return <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>;
  }
  if (selectedProfileId === null) {
    return (
      <div className="state-panel empty-state">
        <h2>クエスト進捗を表示するプロフィールを選択してください</h2>
        <p>プロフィール画面でプロフィールを作成または選択してください。</p>
      </div>
    );
  }

  return (
    <section className="workspace-page" aria-labelledby="quests-title">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">進捗管理</p>
          <h2 id="quests-title">クエスト</h2>
          <p>選択中プロフィールのクエスト達成状態を管理します。</p>
        </div>
      </div>

      <ReportHoldFeedback controller={reportHold} />
      <ReportHoldDialogs controller={reportHold} />
      {masterError && (
        <ErrorBanner
          message={masterError}
          onRetry={reloadReview}
        />
      )}
      {progressError && (
        <ErrorBanner
          message={progressError}
          onRetry={reloadReview}
        />
      )}
      {updateError && (masterRead?.state === "error" && !masterError
        ? <ErrorBanner message={updateError} onRetry={reloadReview} />
        : <div className="error-banner" role="alert">{updateError}</div>)}
      {updateDiagnostic && <p>診断情報：<code>{updateDiagnostic}</code></p>}
      {updateFeedback && <div className="progress-feedback" role="status">{updateFeedback}</div>}

      {isMasterLoading || isProgressLoading || (!progressError && !completionMatches) || (!masterError && masterSnapshot?.reload !== masterReload) ? (
        <div className="state-panel" role="status">クエストを読み込んでいます…</div>
      ) : masterError || progressError ? null : quests.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>クエストのマスターデータがありません</h3>
          <p>「マスターデータ」画面でクエスト情報を取り込むと、クエストの一覧を表示できます。</p>
          <button type="button" className="button primary" onClick={onOpenMasterData}>マスターデータを開く</button>
        </div>
      ) : (
        <QuestTable
          reportHold={reportHold}
          rows={rows}
          paginationResetKey={selectedProfileId}
          onToggleCompletion={toggleCompletion}
          progressReview={progressReview}
          onReloadReview={reloadReview}
        />
      )}
    </section>
  );
}

// 生のSQL・DB内容・パスを表示せず、取得したエラーの分類だけを残す。
function classifyQuestUpdateError(error: unknown): string {
  const value = typeof error === "object" && error !== null ? error : {};
  const kind = "kind" in value && value.kind === "InvalidSelection" ? "InvalidSelection" : "DatabaseError";
  const text = typeof error === "string" ? error : error instanceof Error ? error.message
    : "detail" in value && typeof value.detail === "string" ? value.detail : "";
  const code = /(?:code:\s*|SQLITE_)(\d+)/i.exec(text)?.[1];
  const reason = /pool timed out|pool.*timeout/i.test(text) ? "pool_timeout"
    : /database is locked|SQLITE_BUSY/i.test(text) ? "sqlite_busy"
    : /database table is locked|SQLITE_LOCKED/i.test(text) ? "sqlite_locked"
    : /constraint failed|SQLITE_CONSTRAINT/i.test(text) ? "constraint"
    : /no such (?:table|column)/i.test(text) ? "schema"
    : /readonly|read.only|unable to open/i.test(text) ? "storage"
    : "unclassified";
  return `${kind}:${reason}${code ? `:sqlite_${code}` : ""}`;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="button secondary" onClick={onRetry}>
        再読み込み
      </button>
    </div>
  );
}
