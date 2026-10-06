import { invoke } from "@tauri-apps/api/core";

import type { SelectedImportFile } from "./types";

interface SelectedFilePayload {
  fileName: string;
  bytes: number[];
}

export interface ImportFileAdapter {
  selectFile(): Promise<SelectedImportFile | null>;
}

export class TauriImportFileAdapter implements ImportFileAdapter {
  async selectFile(): Promise<SelectedImportFile | null> {
    const selected = await invoke<SelectedFilePayload | null>(
      "select_import_file",
    );
    if (!selected) {
      return null;
    }
    return {
      fileName: selected.fileName,
      bytes: Uint8Array.from(selected.bytes),
    };
  }
}
