import { describe, expect, it, vi } from "vitest";
import type { invoke } from "@tauri-apps/api/core";
import { DiscoveryStateService, type DiscoveryState } from "./stateService";

const state: DiscoveryState = {
  profileId: 2, discoveryId: 3, progress: null, history: null,
  categoryName: null, active: true, masterUpdatedAt: "original",
  automaticReporting: false, relatedQuests: [],
};

describe("DiscoveryStateService", () => {
  it("passes the full expected snapshot and explicit operation without changing profiles", async () => {
    const call = vi.fn<(...args: Parameters<typeof invoke>) => Promise<DiscoveryState>>().mockResolvedValue(state);
    const service = new DiscoveryStateService(call);
    expect(await service.get(2, 3)).toBe(state);
    expect(call).toHaveBeenLastCalledWith("get_discovery_state", { request: { profileId: 2, discoveryId: 3 } });
    expect(await service.update(state, { kind: "rediscover", hold: true }, 8)).toBe(state);
    expect(call).toHaveBeenLastCalledWith("update_discovery_state", {
      request: { expected: state, sourceMapId: 8, operation: { kind: "rediscover", hold: true } },
    });
  });

  it("preserves conflict errors so callers can reload instead of retrying a blind update", async () => {
    const error = { kind: "DiscoveryStateConflict", userMessage: "再読み込みしてください。" };
    const call = vi.fn<(...args: Parameters<typeof invoke>) => Promise<DiscoveryState>>().mockRejectedValue(error);
    const service = new DiscoveryStateService(call);
    await expect(service.update(state, { kind: "removeCurrent" })).rejects.toBe(error);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
