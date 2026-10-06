export interface QuestProgressStats {
  total: number;
  completed: number;
  incomplete: number;
}

export interface DiscoveryProgressStats {
  total: number;
  discovered: number;
  undiscovered: number;
  unreported: number;
  reported: number;
  cardOwned: number;
  cardCapableDiscovered: number;
}

export interface AdventureMeritStats {
  knownMerit: number;
  reportedCount: number;
  knownExperienceCount: number;
  unknownExperienceCount: number;
}

export interface DiscoveryCategoryProgressStats {
  categoryId: number;
  categoryName: string;
  sortOrder: number;
  total: number;
  discovered: number;
  undiscovered: number;
  unreported: number;
  cardOwned: number;
  canReport: boolean;
  hasCard: boolean;
}

export interface ProgressStats {
  quests: QuestProgressStats;
  discoveries: DiscoveryProgressStats;
  adventureMerit: AdventureMeritStats;
  categories: DiscoveryCategoryProgressStats[];
}

export interface ProgressStatsRepositoryPort {
  getForProfile(profileId: number): Promise<ProgressStats>;
}
