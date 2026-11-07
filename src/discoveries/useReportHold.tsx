import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoveryStateService, type DiscoveryState, type DiscoveryStateOperation, type FirstReportStatus, type MapCurrentState } from "./stateService";
import { discoveryStateReader, matchesSummary, currentState, type DiscoveryStateSummary } from "./stateReader";
import { matchesOfferMethod } from "../quests/offerMethods";

const defaultService = new DiscoveryStateService();
const EMPTY_SUMMARIES = new Map<number,DiscoveryStateSummary>();
export interface ReportHoldDependencies {
  reader: { list(profileId: number): Promise<DiscoveryStateSummary[]> };
  service: Pick<DiscoveryStateService, "get" | "update">;
}
const defaults: ReportHoldDependencies = { reader: discoveryStateReader, service: defaultService };
export type HoldDialog = {
  kind: "history" | "confirm";
  name: string;
  snapshot: DiscoveryState;
  operation?: DiscoveryStateOperation;
  mapId: number | null;
  message?: string;
  initialHistoryStatus?: FirstReportStatus;
};

export function useReportHold(profileId: number | null, onChanged: () => void, dependencies = defaults) {
  const [summaries, setSummaries] = useState(new Map<number, DiscoveryStateSummary>());
  const [summariesProfileId,setSummariesProfileId] = useState<number|null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<HoldDialog | null>(null);
  const [selection, setSelection] = useState<{kind:"multi"; name:string; targets:{id:number;name:string}[]} | null>(null);
  const epoch = useRef(0);
  const readGeneration = useRef(0);
  const profile = useRef(profileId);
  const locked = useRef(false);
  const focus = useRef<HTMLElement | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  profile.current = profileId;

  const reload = useCallback(async () => {
    if (profileId === null) return;
    const token = epoch.current;
    const generation = ++readGeneration.current;
    const rows = await dependencies.reader.list(profileId);
    if (epoch.current === token && profile.current === profileId && readGeneration.current === generation) {
      setSummaries(new Map(rows.map(s => [s.id, s])));setSummariesProfileId(profileId);
    }
  }, [profileId, dependencies]);

  useEffect(() => {
    const token = ++epoch.current;
    setDialog(null); setSelection(null); setSummaries(new Map()); setSummariesProfileId(null); setError(null); setNotice(null); setLoading(true);
    locked.current = false; setBusy(false);
    if (profileId === null) { setLoading(false); return; }
    void reload().catch(() => { if (epoch.current === token) setError("地図・報告履歴を読み込めませんでした。再読み込みしてください。"); })
      .finally(() => { if (epoch.current === token) setLoading(false); });
    return () => { ++epoch.current; };
  }, [profileId, reload]);

  function close() {
    setDialog(null); setSelection(null);
    const element = focus.current;
    queueMicrotask(() => {
      if (element?.isConnected) element.focus();
      else if (element?.dataset.reportFocus) document.querySelector<HTMLElement>(`[data-report-focus="${element.dataset.reportFocus}"]`)?.focus();
    });
  }

  async function save(d: HoldDialog) {
    if (!d.operation || locked.current || profileId === null || d.snapshot.profileId !== profile.current) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await dependencies.service.update(d.snapshot, d.operation, d.mapId);
      if (epoch.current !== token || profile.current !== profileId) return;
      close();
      await reload();
      if (epoch.current === token) { changed.current(); setNotice("状態を保存しました。"); }
    } catch (e: unknown) {
      if (epoch.current !== token || profile.current !== profileId) return;
      close();
      const conflict = typeof e === "object" && e !== null && "kind" in e && e.kind === "DiscoveryStateConflict";
      setError(conflict ? "状態が変更されています。最新の状態を再取得しました。内容を確認して操作し直してください。" : "保存を確認できませんでした。最新の状態を再取得します。");
      try { await reload(); if (epoch.current === token) changed.current(); }
      catch { if (epoch.current === token) { setSummaries(new Map()); setError("状態の再取得に失敗しました。再読み込みするまで操作できません。"); } }
    } finally { if (epoch.current === token) { locked.current = false; setBusy(false); } }
  }

  async function open(id: number, name: string, target: MapCurrentState | "history", mapId: number | null, element: HTMLElement, requireMapRelation = false, initialHistoryStatus?: FirstReportStatus) {
    if (locked.current || dialog || loading || profileId === null) return;
    const displayed = summaries.get(id);
    if (!displayed) return;
    if (target === "history" && (!displayed.mapRelated || displayed.automaticReporting || displayed.categoryName === "レリック")) return;
    if (target !== "history" && target === currentState(displayed)) return;
    if (!selection) focus.current = element;
    setSelection(null);
    const token = epoch.current;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    let next: HoldDialog | null = null;
    try {
      const snapshot = await dependencies.service.get(profileId, id);
      if (epoch.current !== token || profile.current !== profileId) return;
      if ((requireMapRelation || target === "history") && (!snapshot.active || !snapshot.relatedQuests.some(q=>q.active && matchesOfferMethod(q.offerMethod,"group:map")))) {
        await reload();
        if (epoch.current === token && profile.current === profileId) { changed.current(); setError("地図との関連が変更されています。最新の一覧を確認してください。"); }
        return;
      }
      if (!matchesSummary(displayed, snapshot)) {
        await reload();
        if (epoch.current === token && profile.current === profileId) { changed.current(); setError("一覧の状態が変更されています。最新の状態を確認して操作し直してください。"); }
        return;
      }
      if (target === "history") { setDialog({kind:"history", name, snapshot, mapId:null, initialHistoryStatus}); return; }
      const p = snapshot.progress;
      const operation: DiscoveryStateOperation = target === "undiscovered" ? {kind:"removeCurrent"}
        : !p ? {kind:"register",state:target,selectedQuestId:mapId}
        : target === "reported" ? {kind:"report"}
        : {kind:"rediscover",hold:false};
      const message = target === "undiscovered"
        ? "現在の発見進捗、カード所有、発見物メモを削除します。クエスト達成と過去の報告履歴は保持します。"
        : p?.reported ? "再発見して現在未報告になったことを記録します。過去の報告実績は保持します。"
        : target === "reported" ? "実際に報告したことを記録し、初回報告確認済みにします。" : null;
      next = {kind:"confirm",name,snapshot,operation,mapId,message:message ?? undefined};
      if (message) { setDialog(next); next = null; }
    } catch {
      if (epoch.current === token) { setError("現在の状態を確認できませんでした。再読み込みしてください。"); }
    } finally { if (epoch.current === token) { locked.current = false; setBusy(false); } }
    if (next && epoch.current === token) await save(next);
  }

  async function retry() {
    const token = epoch.current;
    setLoading(true); setError(null);
    try { await reload(); }
    catch { if (epoch.current === token) { setSummaries(new Map()); setError("地図・報告履歴の再取得に失敗しました。"); } }
    finally { if (epoch.current === token) setLoading(false); }
  }

  function openSelection(kind:"multi", name:string, targets:{id:number;name:string}[], element:HTMLElement) {
    if (locked.current || dialog || loading || selection) return;
    focus.current=element;
    setSelection({kind,name,targets});
  }

  return { summaries:summariesProfileId===profileId?summaries:EMPTY_SUMMARIES, loading:loading || profileId!==null&&summariesProfileId!==profileId, busy, error, notice, dialog, selection, openSelection, setDialog, close, save, open, reload, retry };
}
export type ReportHoldController = ReturnType<typeof useReportHold>;
