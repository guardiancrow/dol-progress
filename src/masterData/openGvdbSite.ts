import { invoke } from "@tauri-apps/api/core";

export function openGvdbSite(): Promise<void> {
  return invoke("open_gvdb_site");
}
