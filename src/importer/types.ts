export type ImportDataset = "quests" | "discoveries";

export interface ImportWarning {
  code: string;
  message: string;
  rowNumber?: number;
}

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** Zero-based physical data-record order, excluding the header row. */
  sourceOrders: number[];
}

export interface RelationshipReference {
  gvdbId: number;
  displayName: string;
}

export interface NormalizedQuestImportRow {
  gvdbId: number;
  sourceOrder: number;
  title: string;
  difficulty: number | null;
  chronoQuest: string | null;
  offerMethod: string | null;
  offerCity: string | null;
  requiredSkills: string | null;
  discoveryTypeText: string | null;
  discoveryName: string | null;
  rewardItems: string | null;
  notes: string | null;
  sourceUpdatedAt: string | null;
  chainName: string | null;
  chainOrder: number | null;
  prerequisites: RelationshipReference[];
  dependents: RelationshipReference[];
  rawRowJson: string;
}

export interface NormalizedDiscoveryImportRow {
  gvdbId: number;
  sourceOrder: number;
  categoryName: string | null;
  name: string;
  rank: number | null;
  description: string | null;
  era: string | null;
  points: number | null;
  difficulty: number | null;
  experience: number | null;
  notes: string | null;
  sourceUpdatedAt: string | null;
  relatedQuests: RelationshipReference[];
  rawRowJson: string;
}

export interface NormalizedImportRequest {
  dataset: ImportDataset;
  fileName: string;
  sha256: string;
  quests: NormalizedQuestImportRow[];
  discoveries: NormalizedDiscoveryImportRow[];
  warnings: ImportWarning[];
}

export interface ImportResult {
  dataset: ImportDataset;
  fileName: string;
  sha256: string;
  importedRowCount: number;
  insertedCount: number;
  updatedCount: number;
  inactiveCount: number;
  relationCount: number;
  warningCount: number;
  warnings: ImportWarning[];
}

export interface SelectedImportFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface PreparedImport {
  dataset: ImportDataset;
  fileName: string;
  sha256: string;
  rowCount: number;
  warningCount: number;
  request: NormalizedImportRequest;
}
