import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressLinkService } from "./service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ProgressLinkService", () => {
  it("sends quest completion identifiers as a structured Tauri request", async () => {
    invokeMock.mockResolvedValue({
      questChanged: true,
      discoveriesCreated: 2,
      discoveriesAlreadyPresent: 1,
    });

    await new ProgressLinkService().completeQuestWithLinkedDiscoveries(7, 11);

    expect(invokeMock).toHaveBeenCalledWith(
      "complete_quest_with_linked_discoveries",
      { request: { profileId: 7, questId: 11 } },
    );
  });

  it("preserves an explicit no-quest selection for discovery completion", async () => {
    invokeMock.mockResolvedValue({
      discoveryCreated: true,
      questCompleted: false,
      questAlreadyCompleted: false,
      selectedQuestId: null,
    });

    await new ProgressLinkService().discoverWithLinkedQuest(7, 22, null);

    expect(invokeMock).toHaveBeenCalledWith("discover_with_linked_quest", {
      request: { profileId: 7, discoveryId: 22, selectedQuestId: null },
    });
  });
});
