import { invoke } from "@tauri-apps/api/core";

import { decodeCp932 } from "./encoding";
import { asImportError, ImportError } from "./errors";
import type { ImportFileAdapter } from "./fileAdapter";
import { TauriImportFileAdapter } from "./fileAdapter";
import { calculateSha256 } from "./hash";
import { ImportHistoryReader, type ImportHistoryLookup } from "./importHistory";
import { normalizeDiscoveryTable, normalizeQuestTable } from "./normalize";
import { parseTsv } from "./tsv";
import type {
  ImportDataset,
  ImportResult,
  NormalizedImportRequest,
  PreparedImport,
} from "./types";

type ApplyImport = (request: NormalizedImportRequest) => Promise<ImportResult>;

export class ImportService {
  constructor(
    private readonly fileAdapter: ImportFileAdapter = new TauriImportFileAdapter(),
    private readonly historyReader: ImportHistoryLookup = new ImportHistoryReader(),
    private readonly applyImport: ApplyImport = (request) =>
      invoke<ImportResult>("apply_master_import", { request }),
  ) {}

  async selectAndImport(dataset: ImportDataset): Promise<ImportResult | null> {
    const prepared = await this.selectFile(dataset);
    return prepared ? this.importPrepared(prepared) : null;
  }

  async selectFile(dataset: ImportDataset): Promise<PreparedImport | null> {
    const selected = await this.fileAdapter.selectFile();
    if (!selected) {
      return null;
    }
    return this.prepareBytes(dataset, selected.fileName, selected.bytes);
  }

  async prepareBytes(
    dataset: ImportDataset,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<PreparedImport> {
    try {
      const sha256 = await calculateSha256(bytes);
      const table = parseTsv(decodeCp932(bytes));
      const request: NormalizedImportRequest =
        dataset === "quests"
          ? (() => {
              const normalized = normalizeQuestTable(table);
              return {
                dataset,
                fileName,
                sha256,
                quests: normalized.rows,
                discoveries: [],
                warnings: normalized.warnings,
              };
            })()
          : (() => {
              const normalized = normalizeDiscoveryTable(table);
              return {
                dataset,
                fileName,
                sha256,
                quests: [],
                discoveries: normalized.rows,
                warnings: normalized.warnings,
              };
            })();
      return {
        dataset,
        fileName,
        sha256,
        rowCount: dataset === "quests" ? request.quests.length : request.discoveries.length,
        warningCount: request.warnings.length,
        request,
      };
    } catch (error: unknown) {
      throw asImportError(error);
    }
  }

  async importPrepared(prepared: PreparedImport): Promise<ImportResult> {
    try {
      if (await this.historyReader.contains(prepared.dataset, prepared.sha256)) {
        throw new ImportError(
          "DuplicateImport",
          "このファイルは既にインポート済みです。",
          `${prepared.dataset}:${prepared.sha256}`,
        );
      }
      return await this.applyImport(prepared.request);
    } catch (error: unknown) {
      throw asImportError(error);
    }
  }

  async importBytes(
    dataset: ImportDataset,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<ImportResult> {
    return this.importPrepared(await this.prepareBytes(dataset, fileName, bytes));
  }
}
