import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QuestTable } from "../components/quests/QuestTable";
import type { QuestWithDiscoveries } from "../domain/models";
import { useProfiles } from "../profiles/ProfileContext";
import type { ProgressLinkServicePort } from "../progressLink";
import { derivePrerequisiteStatuses, type QuestDependency } from "../quests/prerequisites";
import { resolveDirectPrerequisites } from "../quests/directPrerequisites";
import type {
  QuestProgressRepositoryPort,
  QuestRepositoryPort,
  QuestRowViewModel,
} from "../quests/types";

interface QuestsPageProps {
  questRepository: QuestRepositoryPort;
  questProgressRepository: QuestProgressRepositoryPort;
  progressLinkService: ProgressLinkServicePort;
}

export function QuestsPage({
  questRepository,
  questProgressRepository,
  progressLinkService,
}: QuestsPageProps) {
  const { selectedProfileId, isLoading: isProfileLoading } = useProfiles();
  const [quests, setQuests] = useState<QuestWithDiscoveries[]>([]);
  const [dependencies, setDependencies] = useState<QuestDependency[]>([]);
  const [completedQuestIds, setCompletedQuestIds] = useState<Set<number>>(
    new Set(),
  );
  const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());
  const [isMasterLoading, setIsMasterLoading] = useState(true);
  const [isProgressLoading, setIsProgressLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null);
  const [masterReload, setMasterReload] = useState(0);
  const [progressReload, setProgressReload] = useState(0);
  const progressGeneration = useRef(0);
  const selectedProfileRef = useRef(selectedProfileId);
  const pendingUpdatesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedProfileRef.current = selectedProfileId;
  }, [selectedProfileId]);

  useEffect(() => {
    if (updateFeedback === null) return;
    const timeout = window.setTimeout(() => setUpdateFeedback(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [updateFeedback]);

  useEffect(() => {
    let active = true;
    setIsMasterLoading(true);
    setMasterError(null);
    void Promise.all([questRepository.listWithDiscoveries(), questRepository.listDependencies()])
      .then(([loaded, loadedDependencies]) => {
        if (active) {
          setQuests(loaded);
          setDependencies(loadedDependencies);
        }
      })
      .catch((error: unknown) => {
        console.error("Quest master load failed", error);
        if (active) setMasterError("クエストを読み込めませんでした。");
      })
      .finally(() => {
        if (active) setIsMasterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [masterReload, questRepository]);

  useEffect(() => {
    const generation = ++progressGeneration.current;
    setCompletedQuestIds(new Set());
    setProgressError(null);
    setUpdateError(null);
    setUpdateFeedback(null);
    if (selectedProfileId === null) {
      setIsProgressLoading(false);
      return;
    }

    setIsProgressLoading(true);
    void questProgressRepository
      .listCompletedQuestIds(selectedProfileId)
      .then((ids) => {
        if (progressGeneration.current === generation) {
          setCompletedQuestIds(new Set(ids));
        }
      })
      .catch((error: unknown) => {
        console.error("Quest progress load failed", error);
        if (progressGeneration.current === generation) {
          setProgressError("クエスト進捗を読み込めませんでした。");
        }
      })
      .finally(() => {
        if (progressGeneration.current === generation) {
          setIsProgressLoading(false);
        }
      });
  }, [progressReload, questProgressRepository, selectedProfileId]);

  const toggleCompletion = useCallback(
    async (questId: number, completed: boolean) => {
      const profileId = selectedProfileRef.current;
      if (profileId === null) return;
      const updateKey = `${profileId}:${questId}`;
      if (pendingUpdatesRef.current.has(updateKey)) return;

      pendingUpdatesRef.current.add(updateKey);
      setPendingUpdates(new Set(pendingUpdatesRef.current));
      setUpdateError(null);
      setUpdateFeedback(null);
      try {
        if (completed) {
          await questProgressRepository.markIncomplete(profileId, questId);
        } else {
          const result = await progressLinkService.completeQuestWithLinkedDiscoveries(
            profileId,
            questId,
          );
          if (
            selectedProfileRef.current === profileId &&
            result.discoveriesCreated > 0
          ) {
            setUpdateFeedback(
              `クエストを達成済みにし、関連する発見物 ${result.discoveriesCreated}件を発見済みにしました。`,
            );
          }
        }
        if (selectedProfileRef.current === profileId) {
          setCompletedQuestIds((current) => {
            const next = new Set(current);
            if (completed) next.delete(questId);
            else next.add(questId);
            return next;
          });
        }
      } catch (error: unknown) {
        console.error("Quest progress update failed", error);
        if (selectedProfileRef.current === profileId) {
          setUpdateError("達成状態を更新できませんでした。もう一度お試しください。");
        }
      } finally {
        pendingUpdatesRef.current.delete(updateKey);
        setPendingUpdates(new Set(pendingUpdatesRef.current));
      }
    },
    [progressLinkService, questProgressRepository],
  );

  const directPrerequisites = useMemo(
    () => resolveDirectPrerequisites(quests, dependencies),
    [quests, dependencies],
  );
  const rows = useMemo<QuestRowViewModel[]>(() => {
    const statuses = derivePrerequisiteStatuses(
      quests.map(({ quest }) => quest),
      dependencies,
      completedQuestIds,
    );
    return quests.map(({ quest, discoveries, offerCities, requiredSkillsNormalized }) => ({
        id: quest.id,
        title: quest.title,
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
        completed: completedQuestIds.has(quest.id),
        prerequisiteStatus: statuses.get(quest.id) ?? "UNKNOWN",
        directPrerequisites: directPrerequisites.get(quest.id) ?? [],
        updating:
          selectedProfileId !== null &&
          pendingUpdates.has(`${selectedProfileId}:${quest.id}`),
      }));
  }, [completedQuestIds, dependencies, directPrerequisites, pendingUpdates, quests, selectedProfileId]);

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

      {masterError && (
        <ErrorBanner
          message={masterError}
          onRetry={() => setMasterReload((value) => value + 1)}
        />
      )}
      {progressError && (
        <ErrorBanner
          message={progressError}
          onRetry={() => setProgressReload((value) => value + 1)}
        />
      )}
      {updateError && <div className="error-banner" role="alert">{updateError}</div>}
      {updateFeedback && <div className="progress-feedback" role="status">{updateFeedback}</div>}

      {isMasterLoading || isProgressLoading ? (
        <div className="state-panel" role="status">クエストを読み込んでいます…</div>
      ) : masterError ? null : quests.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>クエストのマスターデータがありません</h3>
          <p>マスターデータの取り込み機能は後続フェーズで提供します。</p>
        </div>
      ) : progressError ? null : (
        <QuestTable
          rows={rows}
          paginationResetKey={selectedProfileId}
          onToggleCompletion={toggleCompletion}
        />
      )}
    </section>
  );
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
