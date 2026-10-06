import type { ImportDataset, ImportResult, PreparedImport } from "../importer";

export interface ImportHistoryEntry {
  id: number;
  dataset: ImportDataset;
  fileName: string;
  rowCount: number | null;
  sourceMaxUpdatedAt: string | null;
  importedAt: string;
}

export interface MasterDatasetStatus {
  dataset: ImportDataset;
  activeCount: number;
  latestImport: ImportHistoryEntry | null;
}

export interface MasterDataStatus {
  datasets: Record<ImportDataset, MasterDatasetStatus>;
  recentHistory: ImportHistoryEntry[];
}

export interface MasterDataStatusRepositoryPort {
  getStatus(): Promise<MasterDataStatus>;
}

export interface MasterImportServicePort {
  selectFile(dataset: ImportDataset): Promise<PreparedImport | null>;
  importPrepared(prepared: PreparedImport): Promise<ImportResult>;
}
