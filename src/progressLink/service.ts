import { invoke } from "@tauri-apps/api/core";

import type {
  DiscoveryCompletionResult,
  ProgressLinkServicePort,
  QuestCompletionResult,
} from "./types";

export class ProgressLinkService implements ProgressLinkServicePort {
  async completeQuestWithLinkedDiscoveries(
    profileId: number,
    questId: number,
  ): Promise<QuestCompletionResult> {
    return invoke<QuestCompletionResult>(
      "complete_quest_with_linked_discoveries",
      { request: { profileId, questId } },
    );
  }

  async discoverWithLinkedQuest(
    profileId: number,
    discoveryId: number,
    selectedQuestId: number | null,
  ): Promise<DiscoveryCompletionResult> {
    return invoke<DiscoveryCompletionResult>("discover_with_linked_quest", {
      request: { profileId, discoveryId, selectedQuestId },
    });
  }
}
