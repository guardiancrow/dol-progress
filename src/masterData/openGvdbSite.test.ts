import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openGvdbSite } from "./openGvdbSite";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("openGvdbSite", () => {
  it("invokes only the fixed, argument-free Tauri command", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await openGvdbSite();
    expect(invoke).toHaveBeenCalledWith("open_gvdb_site");
  });
});
