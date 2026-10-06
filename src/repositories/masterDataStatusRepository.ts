import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { handleDatabaseErrors } from "../db/errors";
import type { ImportDataset } from "../importer";
import type {
  ImportHistoryEntry,
  MasterDataStatus,
} from "../masterData/types";

interface CountRow {
  dataset: ImportDataset;
  activeCount: number;
}

interface HistoryRow {
  id: number;
  dataset: ImportDataset;
  fileName: string;
  rowCount: number | null;
  sourceMaxUpdatedAt: string | null;
  importedAt: string;
}

export class MasterDataStatusRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async getStatus(): Promise<MasterDataStatus> {
    return handleDatabaseErrors("masterDataStatus.getStatus", async () => {
      const database = await this.databaseProvider();
      const [countRows, historyRows] = await Promise.all([
        database.select<CountRow[]>(
          `SELECT 'quests' AS dataset, COUNT(*) AS activeCount
           FROM quests WHERE is_active = 1
           UNION ALL
           SELECT 'discoveries' AS dataset, COUNT(*) AS activeCount
           FROM discoveries WHERE is_active = 1`,
        ),
        database.select<HistoryRow[]>(
          `SELECT id,
                  dataset,
                  file_name AS fileName,
                  row_count AS rowCount,
                  source_max_updated_at AS sourceMaxUpdatedAt,
                  imported_at AS importedAt
           FROM master_import_history
           ORDER BY id DESC
           LIMIT 10`,
        ),
      ]);

      const activeCounts = new Map(countRows.map((row) => [row.dataset, row.activeCount]));
      const recentHistory: ImportHistoryEntry[] = historyRows;
      return {
        datasets: {
          quests: {
            dataset: "quests",
            activeCount: activeCounts.get("quests") ?? 0,
            latestImport: recentHistory.find((entry) => entry.dataset === "quests") ?? null,
          },
          discoveries: {
            dataset: "discoveries",
            activeCount: activeCounts.get("discoveries") ?? 0,
            latestImport: recentHistory.find((entry) => entry.dataset === "discoveries") ?? null,
          },
        },
        recentHistory,
      };
    });
  }
}
