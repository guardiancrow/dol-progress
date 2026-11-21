import { useCallback, useEffect, useRef, useState } from "react";
import { DiscoveryStateService, type DiscoveryState, type DiscoveryStateOperation, type FirstReportStatus, type MapCurrentState } from "./stateService";
import { discoveryStateReader, matchesSummary, matchesSnapshot, currentState, type DiscoveryStateSummary } from "./stateReader";
import { matchesOfferMethod } from "../quests/offerMethods";
import type { ProgressReadKind, WorkspaceReadScope } from "../workspaceReads/WorkspaceReads";

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

export function useReportHold(profileId: number | null, onChanged: (reason?: "progress") => void, dependencies = defaults,
  masterRevision = 0, scope?: WorkspaceReadScope) {
  const [loadedSummaries, setLoadedSummaries] = useState<{ profileId: number; masterRevision: number; values: Map<number, DiscoveryStateSummary> }>();
  const summaries = loadedSummaries?.profileId === profileId && loadedSummaries.masterRevision === masterRevision
    ? loadedSummaries.values : EMPTY_SUMMARIES;
  const [summaryRead, setSummaryRead] = useState<{profileId: number; masterRevision: number; state: "loading" | "ready" | "error"} | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<HoldDialog | null>(null);
  const [selection, setSelection] = useState<{kind:"multi"; name:string; targets:{id:number;name:string}[]} | null>(null);
  const epoch = useRef(0);
  const readGeneration = useRef(0);
  const profile = useRef(profileId);
  const currentMasterRevision = useRef(masterRevision);
  const loadedMasterRevision = useRef(masterRevision);
  const locked = useRef(false);
  const focus = useRef<HTMLElement | null>(null);
  const focusPending = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  profile.current = profileId;
  currentMasterRevision.current = masterRevision;

  const reload = useCallback(async function loadSummaries(fresh = true) {
    if (profileId === null || scope?.owner.active === false) return;
    const token = epoch.current;
    const generation = ++readGeneration.current;
    const revision = currentMasterRevision.current;
    loadedMasterRevision.current = revision;
    const isCurrent = () => scope?.owner.active !== false && epoch.current === token && profile.current === profileId && readGeneration.current === generation
      && currentMasterRevision.current === revision;
    const load = async () => new Map((await dependencies.reader.list(profileId)).map(summary => [summary.id, summary]));
    const read = scope?.reads.read("report", dependencies.reader, profileId, load, { fresh, active: isCurrent, masterRevision: revision });
    const canAdopt = () => isCurrent() && (read?.isCurrent() ?? true);
    setSummaryRead({profileId, masterRevision: revision, state: "loading"});
    try {
      const rows = await (read?.promise ?? load());
      if (isCurrent() && read && !read.isCurrent()) return loadSummaries(false);
      if (canAdopt()) {
        setLoadedSummaries({ profileId, masterRevision: revision, values: rows });
        setSummaryRead({profileId, masterRevision: revision, state: "ready"});
      }
    } catch (error: unknown) {
      if (isCurrent() && read && !read.isCurrent()) return loadSummaries(false);
      if (!canAdopt()) return;
      setSummaryRead({profileId, masterRevision: revision, state: "error"});
      setError("地図・報告履歴を読み込めませんでした。再読み込みしてください。");
      throw error;
    }
  }, [profileId, dependencies, scope]);

  useEffect(() => {
    const token = ++epoch.current;
    focusPending.current = false;
    setDialog(null); setSelection(null); setLoadedSummaries(undefined); setError(null); setNotice(null); setLoading(true);
    locked.current = false; setBusy(false);
    if (profileId === null) { setLoading(false); return; }
    void reload(false).catch(() => { if (epoch.current === token) setError("地図・報告履歴を読み込めませんでした。再読み込みしてください。"); })
      .finally(() => { if (epoch.current === token) setLoading(false); });
    return () => { ++epoch.current; };
  }, [profileId, reload]);

  useEffect(() => {
    if (profileId !== null && loadedMasterRevision.current !== masterRevision) void reload(false).catch(() => undefined);
  }, [masterRevision, profileId, reload]);

  useEffect(() => scope?.reads.subscribe(change => {
    if (change.profileId === profileId && change.owner !== scope.owner && change.kinds.includes("report")) {
      void reload(false).catch(() => undefined);
    }
  }), [scope, profileId, reload]);

  useEffect(() => {
    if (!focusPending.current || dialog || selection || busy || loading) return;
    focusPending.current = false;
    const element = focus.current;
    if (element?.isConnected) element.focus();
    else if (element?.dataset.reportFocus) document.querySelector<HTMLElement>(`[data-report-focus="${element.dataset.reportFocus}"]`)?.focus();
  }, [dialog, selection, busy, loading, summaries]);

  function close() {
    focusPending.current = true;
    setDialog(null); setSelection(null);
  }

  async function save(d: HoldDialog) {
    const operation = d.operation;
    if (!operation || locked.current || profileId === null || d.snapshot.profileId !== profile.current) return;
    const token = epoch.current;
    const isCurrent = () => scope?.owner.active !== false && epoch.current === token && profile.current === profileId;
    let attempted = false;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      if (d.kind === "history") {
        const latest = await dependencies.service.get(profileId, d.snapshot.discoveryId);
        if (!isCurrent()) return;
        if (!matchesSnapshot(d.snapshot, latest) || !latest.active || latest.automaticReporting || latest.categoryName === "レリック" ||
          operation.kind === "correctHistory" && operation.status === "unknown" &&
            (latest.progress?.reported || operation.removeLegacyCredit || operation.currentState !== null)) {
          throw {kind:"DiscoveryStateConflict"};
        }
      }
      const write = () => dependencies.service.update(d.snapshot, operation, d.mapId);
      const affected: ProgressReadKind[] = ["discoveryProgress", "report"];
      if (operation.kind === "register") affected.push("questProgress");
      attempted = true;
      await (scope ? scope.reads.write(scope.owner, profileId, affected, write) : write());
      if (!isCurrent()) return;
      close();
      await reload(false);
      if (isCurrent()) { changed.current("progress"); setNotice("状態を保存しました。"); }
    } catch (e: unknown) {
      if (!isCurrent()) return;
      close();
      const conflict = typeof e === "object" && e !== null && "kind" in e && e.kind === "DiscoveryStateConflict";
      setError(conflict ? "状態が変更されています。最新の状態を再取得しました。内容を確認して操作し直してください。" : "保存を確認できませんでした。最新の状態を再取得します。");
      try { await reload(!attempted); if (isCurrent()) changed.current(attempted && !conflict ? "progress" : undefined); }
      catch { if (isCurrent()) {
        setLoadedSummaries(undefined);
        if (attempted && scope) changed.current("progress");
        setError("状態の再取得に失敗しました。再読み込みするまで操作できません。");
      } }
    } finally { if (isCurrent()) { locked.current = false; setBusy(false); } }
  }

  async function open(id: number, name: string, target: MapCurrentState | "history", mapId: number | null, element: HTMLElement, requireMapRelation = false, initialHistoryStatus?: FirstReportStatus) {
    if (locked.current || dialog || loading || profileId === null) return;
    const displayed = summaries.get(id);
    if (!displayed) return;
    if (target === "history" && (summaryRead?.profileId !== profileId || summaryRead.state !== "ready" ||
      !displayed.active || displayed.automaticReporting || displayed.categoryName === "レリック")) return;
    if (target !== "history" && target === currentState(displayed)) return;
    if (!selection) focus.current = element;
    setSelection(null);
    const token = epoch.current;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    let next: HoldDialog | null = null;
    try {
      const snapshot = await dependencies.service.get(profileId, id);
      if (epoch.current !== token || profile.current !== profileId) return;
      const snapshotMapRelated = snapshot.relatedQuests.some(q=>q.active && matchesOfferMethod(q.offerMethod,"group:map"));
      if (requireMapRelation && (!snapshot.active || !snapshotMapRelated) ||
        target === "history" && Boolean(displayed.mapRelated) !== snapshotMapRelated) {
        await reload();
        if (epoch.current === token && profile.current === profileId) { changed.current(); setError("地図との関連が変更されています。最新の一覧を確認してください。"); }
        return;
      }
      if (snapshot.profileId !== profileId || snapshot.discoveryId !== id || !matchesSummary(displayed, snapshot) ||
        target === "history" && (!snapshot.active || snapshot.automaticReporting || snapshot.categoryName === "レリック")) {
        await reload();
        if (epoch.current === token && profile.current === profileId) { changed.current(); setError("一覧の状態が変更されています。最新の状態を確認して操作し直してください。"); }
        return;
      }
      if (target === "history") {
        const knownHistory = snapshot.history?.status === "confirmed" || snapshot.history?.status === "not_reported";
        setDialog({kind:"history", name, snapshot, mapId:null, initialHistoryStatus:knownHistory ? initialHistoryStatus : undefined});
        return;
      }
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
    catch { if (epoch.current === token) { setLoadedSummaries(undefined); setError("地図・報告履歴の再取得に失敗しました。"); } }
    finally { if (epoch.current === token) setLoading(false); }
  }

  function openSelection(kind:"multi", name:string, targets:{id:number;name:string}[], element:HTMLElement) {
    if (locked.current || dialog || loading || selection) return;
    focus.current=element;
    setSelection({kind,name,targets});
  }

  const summaryReadState = summaryRead?.profileId === profileId && summaryRead.masterRevision === masterRevision ? summaryRead.state : "loading";
  return { summaries, summaryReadState, loading:loading || profileId!==null&&summaryReadState === "loading", busy, error, notice, dialog, selection, openSelection, setDialog, close, save, open, reload, retry };
}
export type ReportHoldController = ReturnType<typeof useReportHold>;
