export interface Profile {
  id: number;
  name: string;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryCategory {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Quest {
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
  isActive: boolean;
  rawRowJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestDiscoverySummary {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  categorySortOrder: number | null;
}

export interface QuestRequiredSkill {
  position: number;
  skillName: string;
  requiredRank: number | null;
  isLanguage: boolean;
}

export interface QuestOfferCity {
  position: number;
  cityName: string;
}

export interface QuestWithDiscoveries {
  quest: Quest;
  discoveries: QuestDiscoverySummary[];
  requiredSkillsNormalized: QuestRequiredSkill[];
  offerCities: QuestOfferCity[];
}

export interface Discovery {
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
  isActive: boolean;
  rawRowJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryCategorySummary {
  id: number;
  name: string;
  sortOrder: number;
}

export interface DiscoveryRelatedQuestSummary {
  id: number;
  title: string;
}

export interface DiscoveryWithRelations {
  discovery: Discovery;
  category: DiscoveryCategorySummary | null;
  relatedQuests: DiscoveryRelatedQuestSummary[];
}

export interface QuestProgress {
  profileId: number;
  questId: number;
  memo: string | null;
  updatedAt: string;
}

export interface DiscoveryProgress {
  profileId: number;
  discoveryId: number;
  reported: boolean;
  cardOwned: boolean;
  memo: string | null;
  updatedAt: string;
}
