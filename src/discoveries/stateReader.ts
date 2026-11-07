import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import summarySql from "./discoveryStateSummaries.sql?raw";
import { automaticReportingDiscoveriesSql } from "./automaticReporting";
import type { FirstReportStatus, MapCurrentState, DiscoveryState } from "./stateService";

export interface DiscoveryStateSummary {
  id: number;
  active: number;
  categoryName: string | null;
  experience: number | null;
  masterUpdatedAt: string;
  discovered: number;
  reported: number;
  reportHold: number;
  progressUpdatedAt: string | null;
  firstReportStatus: FirstReportStatus;
  legacyMeritCredit: number;
  historyUpdatedAt: string | null;
  automaticReporting: number;
  mapRelated?: number;
  mapNeedsReview?: number;
}

export class DiscoveryStateReader {
  constructor(private readonly provider: DatabaseProvider = getDatabase) {}
  async list(profileId: number): Promise<DiscoveryStateSummary[]> {
    const db = await this.provider();
    return db.select<DiscoveryStateSummary[]>(summarySql.replace("__AUTOMATIC_REPORTING_DISCOVERIES__", automaticReportingDiscoveriesSql), [profileId]);
  }
}

export const discoveryStateReader = new DiscoveryStateReader();

export function currentState(s: DiscoveryStateSummary): MapCurrentState {
  if (!s.discovered) return "undiscovered";
  if (s.reported || s.automaticReporting) return "reported";
  return "unreported";
}

export function matchesSummary(s: DiscoveryStateSummary, snapshot: DiscoveryState): boolean {
  return Boolean(s.discovered) === (snapshot.progress !== null)
    && Boolean(s.reported) === (snapshot.progress?.reported ?? false)
    && Boolean(s.reportHold) === (snapshot.progress?.reportHold ?? false)
    && s.progressUpdatedAt === (snapshot.progress?.updatedAt ?? null)
    && s.firstReportStatus === (snapshot.history?.status ?? "unknown")
    && Boolean(s.legacyMeritCredit) === (snapshot.history?.legacyMeritCredit ?? false)
    && s.historyUpdatedAt === (snapshot.history?.updatedAt ?? null)
    && Boolean(s.active) === snapshot.active
    && s.categoryName === snapshot.categoryName
    && s.masterUpdatedAt === snapshot.masterUpdatedAt
    && Boolean(s.automaticReporting) === snapshot.automaticReporting;
}

export type VisibleMapState = Exclude<MapCurrentState, "reportHold">;
export const stateLabels: Record<VisibleMapState, string> = {
  undiscovered: "未発見", unreported: "未報告", reported: "報告済み",
};
export const stateOrder = Object.keys(stateLabels) as VisibleMapState[];

export function meritReference(states: Iterable<DiscoveryStateSummary>): {known:number; unknown:number} {
  let known=0,unknown=0;
  for(const s of states) {
    if(s.categoryName === "レリック" || !(s.firstReportStatus === "confirmed" || s.legacyMeritCredit || s.discovered && s.automaticReporting)) continue;
    if(s.experience === null) unknown++; else known+=s.experience;
  }
  return {known,unknown};
}
