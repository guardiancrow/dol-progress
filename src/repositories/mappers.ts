import type {
  Discovery,
  DiscoveryCategory,
  DiscoveryProgress,
  Profile,
  Quest,
  QuestProgress,
} from "../domain/models";

export interface ProfileRow {
  id: number;
  name: string;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryCategoryRow {
  id: number;
  name: string;
  sortOrder: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuestRow {
  id: number;
  gvdbId: number;
  title: string;
  difficulty: number | null;
  chronoQuest: string | null;
  offerMethod: string | null;
  offerCity: string | null;
  requiredSkills: string | null;
  discoveryTypeText: string | null;
  rewardItems: string | null;
  notes: string | null;
  chainName: string | null;
  chainOrder: number | null;
  sourceUpdatedAt: string | null;
  isActive: number;
  rawRowJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryRow {
  id: number;
  gvdbId: number;
  categoryId: number | null;
  name: string;
  rank: number | null;
  description: string | null;
  era: string | null;
  points: number | null;
  difficulty: number | null;
  experience: number | null;
  notes: string | null;
  sourceUpdatedAt: string | null;
  isActive: number;
  rawRowJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestProgressRow {
  profileId: number;
  questId: number;
  memo: string | null;
  updatedAt: string;
}

export interface DiscoveryProgressRow {
  profileId: number;
  discoveryId: number;
  reported: number;
  cardOwned: number;
  memo: string | null;
  updatedAt: string;
}

export interface EntityIdRow {
  id: number;
}

export function mapProfile(row: ProfileRow): Profile {
  return row;
}

export function mapDiscoveryCategory(
  row: DiscoveryCategoryRow,
): DiscoveryCategory {
  return { ...row, isActive: row.isActive === 1 };
}

export function mapQuest(row: QuestRow): Quest {
  return { ...row, isActive: row.isActive === 1 };
}

export function mapDiscovery(row: DiscoveryRow): Discovery {
  return { ...row, isActive: row.isActive === 1 };
}

export function mapQuestProgress(row: QuestProgressRow): QuestProgress {
  return row;
}

export function mapDiscoveryProgress(
  row: DiscoveryProgressRow,
): DiscoveryProgress {
  return {
    ...row,
    reported: row.reported === 1,
    cardOwned: row.cardOwned === 1,
  };
}
