import { invoke } from "@tauri-apps/api/core";

export function openReleasesPage(): Promise<void> {
  return invoke("open_releases_page");
}
