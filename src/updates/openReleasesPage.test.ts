import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openReleasesPage } from "./openReleasesPage";

vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn().mockResolvedValue(undefined)}));
it("invokes an argument-free fixed Releases command",async()=>{
  await openReleasesPage();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("open_releases_page");
});
