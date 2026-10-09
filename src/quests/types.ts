import type { QuestDiscoverySummary, QuestRequiredSkill, QuestWithDiscoveries } from "../domain/models";
import type { QuestDependency, PrerequisiteStatus } from "./prerequisites";
import type { DirectPrerequisite } from "./directPrerequisites";

export interface QuestRepositoryPort {
  listWithDiscoveries(): Promise<QuestWithDiscoveries[]>;
  listDependencies(): Promise<QuestDependency[]>;
}

export interface QuestProgressRepositoryPort {
  listCompletedQuestIds(profileId: number): Promise<number[]>;
  markCompleted(profileId: number, questId: number): Promise<void>;
  markIncomplete(profileId: number, questId: number): Promise<void>;
}

export interface QuestRowViewModel {
  id: number;
  title: string;
  notes: string | null;
  difficulty: number | null;
  offerMethod: string | null;
  offerCity: string | null;
  offerCities: string[];
  requiredSkills: string | null;
  requiredSkillNames: string[];
  requiredSkillsNormalized: Array<Pick<QuestRequiredSkill, "skillName" | "requiredRank">>;
  discoveries: QuestDiscoverySummary[];
  completed: boolean;
  updating: boolean;
  prerequisiteStatus: PrerequisiteStatus;
  directPrerequisites: DirectPrerequisite[];
}
