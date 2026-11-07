import { invoke } from "@tauri-apps/api/core";

export type FirstReportStatus = "unknown" | "not_reported" | "confirmed";
export type MapCurrentState = "undiscovered" | "unreported" | "reported" | "reportHold";

export interface DiscoveryState {
  profileId: number;
  discoveryId: number;
  progress: {
    reported: boolean;
    reportHold: boolean;
    cardOwned: boolean;
    memo: string | null;
    updatedAt: string;
  } | null;
  history: {
    status: FirstReportStatus;
    legacyMeritCredit: boolean;
    updatedAt: string;
  } | null;
  categoryName: string | null;
  active: boolean;
  masterUpdatedAt: string;
  automaticReporting: boolean;
  relatedQuests: {
    id: number;
    offerMethod: string | null;
    active: boolean;
    updatedAt: string;
    discoveryCount: number;
  }[];
}

export type DiscoveryStateOperation =
  | { kind: "register"; state: MapCurrentState; selectedQuestId: number | null }
  | { kind: "report" }
  | { kind: "rediscover"; hold: boolean }
  | { kind: "setHold"; value: boolean }
  | {
    kind: "correctHistory";
    status: FirstReportStatus;
    removeLegacyCredit: boolean;
    currentState: MapCurrentState | null;
  }
  | { kind: "removeCurrent" };

// Error objects (especially DiscoveryStateConflict) are retained for C3 to request a reload.
export class DiscoveryStateService {
  constructor(private readonly invokeCommand: (command: string, args: { request: unknown }) => Promise<DiscoveryState> = invoke) {}

  get(profileId: number, discoveryId: number): Promise<DiscoveryState> {
    return this.invokeCommand("get_discovery_state", { request: { profileId, discoveryId } });
  }

  update(
    expected: DiscoveryState,
    operation: DiscoveryStateOperation,
    sourceMapId: number | null = null,
  ): Promise<DiscoveryState> {
    return this.invokeCommand("update_discovery_state", {
      request: { expected, sourceMapId, operation },
    });
  }
}
