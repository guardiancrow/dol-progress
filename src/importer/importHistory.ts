import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import type { ImportDataset } from "./types";

interface ExistsRow {
  imported: number;
}

export interface ImportHistoryLookup {
  contains(dataset: ImportDataset, sha256: string): Promise<boolean>;
}

export class ImportHistoryReader implements ImportHistoryLookup {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async contains(dataset: ImportDataset, sha256: string): Promise<boolean> {
    const database = await this.databaseProvider();
    const masterTable = dataset === "quests" ? "quests" : "discoveries";
    const rows = await database.select<ExistsRow[]>(
      `SELECT EXISTS(
         SELECT 1 FROM master_import_history
         WHERE dataset = $1 AND file_sha256 = $2
       )
       AND NOT EXISTS(
         SELECT 1 FROM ${masterTable}
         WHERE is_active = 1 AND source_order IS NULL
       ) AS imported`,
      [dataset, sha256],
    );
    return rows[0]?.imported === 1;
  }
}
