export interface QuestCompletionResult {
  questChanged: boolean;
  discoveriesCreated: number;
  discoveriesAlreadyPresent: number;
}

export interface DiscoveryCompletionResult {
  discoveryCreated: boolean;
  questCompleted: boolean;
  questAlreadyCompleted: boolean;
  selectedQuestId: number | null;
}

export interface ProgressLinkServicePort {
  completeQuestWithLinkedDiscoveries(
    profileId: number,
    questId: number,
  ): Promise<QuestCompletionResult>;

  discoverWithLinkedQuest(
    profileId: number,
    discoveryId: number,
    selectedQuestId: number | null,
  ): Promise<DiscoveryCompletionResult>;
}
