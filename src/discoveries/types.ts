import type {
  DiscoveryProgress,
  DiscoveryWithRelations,
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

export interface DiscoveryRowViewModel {
  id: number;
  name: string;
  category: { id: number; name: string; sortOrder: number } | null;
  rank: number | null;
  era: string | null;
  points: number | null;
  difficulty: number | null;
  experience: number | null;
  relatedQuests: Array<{ id: number; title: string }>;
  canReport: boolean;
  hasCard: boolean;
  status: DiscoveryStatus;
  progress: DiscoveryProgress | null;
  updating: boolean;
}
