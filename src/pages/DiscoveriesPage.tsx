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

interface DiscoveriesPageProps {
  discoveryRepository: DiscoveryRepositoryPort;
  discoveryProgressRepository: DiscoveryProgressRepositoryPort;
  progressLinkService: ProgressLinkServicePort;
  initialCategoryId?: number;
  onCategoryNavigationConsumed?(): void;
}

export function DiscoveriesPage({
  discoveryRepository,
  discoveryProgressRepository,
  progressLinkService,
  initialCategoryId,
  onCategoryNavigationConsumed,
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
    void discoveryRepository
      .listWithRelations()
      .then((loaded) => {
        if (active) setDiscoveries(loaded);
      })
      .catch((error: unknown) => {
        console.error("Discovery master load failed", error);
        if (active) setMasterError("発見物を読み込めませんでした。");
      })
      .finally(() => {
        if (active) setIsMasterLoading(false);
      });
    return () => {
      active = false;
    };
  }, [discoveryRepository, masterReload]);

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
    void discoveryProgressRepository
      .listByProfile(selectedProfileId)
      .then((progress) => {
        if (progressGeneration.current === generation) {
          setProgressById(new Map(progress.map((item) => [item.discoveryId, item])));
        }
      })
      .catch((error: unknown) => {
        console.error("Discovery progress load failed", error);
        if (progressGeneration.current === generation) {
          setProgressError("発見物進捗を読み込めませんでした。");
        }
      })
      .finally(() => {
        if (progressGeneration.current === generation) setIsProgressLoading(false);
      });
  }, [discoveryProgressRepository, progressReload, selectedProfileId]);

  const runUpdate = useCallback(
    async <T,>(
      discoveryId: number,
      operation: (profileId: number) => Promise<T>,
      update: (current: DiscoveryProgress | null, profileId: number) => DiscoveryProgress | null,
      onSuccess?: (result: T) => void,
    ) => {
      const profileId = selectedProfileRef.current;
      if (profileId === null) return;
      const key = `${profileId}:${discoveryId}`;
      if (pendingUpdatesRef.current.has(key)) return;
      pendingUpdatesRef.current.add(key);
      setPendingUpdates(new Set(pendingUpdatesRef.current));
      setUpdateError(null);
      setUpdateFeedback(null);
      try {
        const result = await operation(profileId);
        if (selectedProfileRef.current === profileId) {
          setProgressById((current) => {
            const next = new Map(current);
            const changed = update(current.get(discoveryId) ?? null, profileId);
            if (changed) next.set(discoveryId, changed);
            else next.delete(discoveryId);
            return next;
          });
          onSuccess?.(result);
        }
      } catch (error: unknown) {
        console.error("Discovery progress update failed", error);
        if (selectedProfileRef.current === profileId) {
          setUpdateError("発見物進捗を更新できませんでした。もう一度お試しください。");
        }
      } finally {
        pendingUpdatesRef.current.delete(key);
        setPendingUpdates(new Set(pendingUpdatesRef.current));
      }
    },
    [],
  );

  const markDiscovered = useCallback(
    async (discoveryId: number, selectedQuestId: number | null) => {
      const target = discoveries.find((item) => item.discovery.id === discoveryId);
      const capabilities = discoveryCapabilities(target?.category ?? null);
      await runUpdate(
        discoveryId,
        (profileId) =>
          progressLinkService.discoverWithLinkedQuest(
            profileId,
            discoveryId,
            selectedQuestId,
          ),
        (progress, profileId) =>
          progress ?? {
            profileId,
            discoveryId,
            reported: false,
            cardOwned: capabilities.hasCard,
            memo: null,
            updatedAt: new Date().toISOString(),
          },
        (result: DiscoveryCompletionResult) => {
          if (result.questCompleted) {
            setUpdateFeedback(
              "発見物を発見済みにし、関連クエストを達成済みにしました。",
            );
          }
        },
      );
    },
    [discoveries, progressLinkService, runUpdate],
  );

  const toggleDiscovered = useCallback(
    async (discoveryId: number, discovered: boolean) => {
      const current = progressById.get(discoveryId) ?? null;
      if (discovered) {
        const memoWarning = current?.memo
          ? "\nこの発見物のメモも削除されます。"
          : "\nこの発見物に保存されたメモがある場合は削除されます。";
        if (!window.confirm(`未発見に戻しますか？報告状態とカード所有状態も削除されます。${memoWarning}`)) return;
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
    async (discoveryId: number, reported: boolean) =>
      runUpdate(
        discoveryId,
        (profileId) => discoveryProgressRepository.setReported(profileId, discoveryId, reported),
        (progress) => (progress ? { ...progress, reported, updatedAt: new Date().toISOString() } : null),
      ),
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
      discoveries.map(({ discovery, category, relatedQuests }) => {
        const progress = progressById.get(discovery.id) ?? null;
        const capabilities = discoveryCapabilities(category);
        return {
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
          status: progress === null ? "undiscovered" : progress.reported ? "reported" : "unreported",
          progress,
          updating:
            selectedProfileId !== null && pendingUpdates.has(`${selectedProfileId}:${discovery.id}`),
        };
      }),
    [discoveries, pendingUpdates, progressById, selectedProfileId],
  );

  if (isProfileLoading) return <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>;
  if (selectedProfileId === null) {
    return <div className="state-panel empty-state"><h2>発見物進捗を表示するプロフィールを選択してください</h2><p>プロフィール画面でプロフィールを作成または選択してください。</p></div>;
  }

  return (
    <section className="workspace-page" aria-labelledby="discoveries-title">
      <div className="page-heading"><div><p className="page-eyebrow">進捗管理</p><h2 id="discoveries-title">発見物</h2><p>発見・報告・カード所有の状態を個別に管理します。</p></div></div>
      {masterError && <ErrorBanner message={masterError} onRetry={() => setMasterReload((value) => value + 1)} />}
      {progressError && <ErrorBanner message={progressError} onRetry={() => setProgressReload((value) => value + 1)} />}
      {updateError && <div className="error-banner" role="alert">{updateError}</div>}
      {updateFeedback && <div className="progress-feedback" role="status">{updateFeedback}</div>}
      {isMasterLoading || isProgressLoading ? (
        <div className="state-panel" role="status">発見物を読み込んでいます…</div>
      ) : masterError ? null : discoveries.length === 0 ? (
        <div className="state-panel empty-state"><h3>発見物のマスターデータがありません</h3><p>マスターデータを取り込んでからご利用ください。</p></div>
      ) : progressError ? null : (
        <DiscoveryTable
          rows={rows}
          initialCategoryId={initialCategoryId}
          onCategoryNavigationConsumed={onCategoryNavigationConsumed}
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
