import type {
  DiscoveryProgress,
  DiscoveryWithRelations,
  DiscoveryRelatedQuestSummary,
} from "../domain/models";

export interface DiscoveryRepositoryPort {
  listWithRelations(): Promise<DiscoveryWithRelations[]>;
}

export interface DiscoveryProgressRepositoryPort {
  listByProfile(profileId: number): Promise<DiscoveryProgress[]>;
  markDiscovered(profileId: number, discoveryId: number): Promise<void>;
  markUndiscovered(profileId: number, discoveryId: number): Promise<void>;
  setReported(
    profileId: number,
    discoveryId: number,
    reported: boolean,
  ): Promise<void>;
  setCardOwned(
    profileId: number,
    discoveryId: number,
    cardOwned: boolean,
  ): Promise<void>;
}

export type DiscoveryStatus = "undiscovered" | "unreported" | "reported";

export type DiscoveryInitialFilter =
  | { kind: "category"; categoryId: number }
  | { kind: "unreported" }
  | { kind: "card-not-owned" };

export interface DiscoveryRowViewModel {
  unreportedHistoryReady?: boolean;
  firstReportStatus?: import("./stateService").FirstReportStatus;
  historyPresent?: boolean;
  legacyMeritCredit?: boolean;
  mapRelated?: boolean;
  mapNeedsReview?: boolean;
  automaticReporting: boolean;
  effectiveReported: boolean;
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  category: { id: number; name: string; sortOrder: number } | null;
  rank: number | null;
  era: string | null;
  points: number | null;
  difficulty: number | null;
  experience: number | null;
  relatedQuests: DiscoveryRelatedQuestSummary[];
  canReport: boolean;
  hasCard: boolean;
  status: DiscoveryStatus;
  progress: DiscoveryProgress | null;
  updating: boolean;
}
