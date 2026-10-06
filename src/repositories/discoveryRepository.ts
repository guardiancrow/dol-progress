import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { handleDatabaseErrors } from "../db/errors";
import type { Discovery, DiscoveryWithRelations } from "../domain/models";
import { mapDiscovery, type DiscoveryRow } from "./mappers";

const DISCOVERY_SELECT = `
  SELECT id,
         gvdb_id AS gvdbId,
         category_id AS categoryId,
         name,
         rank,
         description,
         era,
         points,
         difficulty,
         experience,
         notes,
         source_updated_at AS sourceUpdatedAt,
         is_active AS isActive,
         raw_row_json AS rawRowJson,
         created_at AS createdAt,
         updated_at AS updatedAt
  FROM discoveries`;

export class DiscoveryRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async getById(discoveryId: number): Promise<Discovery | null> {
    return this.getOne("discovery.getById", "id", discoveryId);
  }

  async getByGvdbId(gvdbId: number): Promise<Discovery | null> {
    return this.getOne("discovery.getByGvdbId", "gvdb_id", gvdbId);
  }

  async list(): Promise<Discovery[]> {
    return this.getMany(
      "discovery.list",
      `${DISCOVERY_SELECT} ORDER BY source_order IS NULL, source_order, id`,
    );
  }

  async searchByName(query: string): Promise<Discovery[]> {
    return this.getMany(
      "discovery.searchByName",
      `${DISCOVERY_SELECT} WHERE instr(name, $1) > 0 ORDER BY source_order IS NULL, source_order, id`,
      [query],
    );
  }

  async getByCategory(categoryId: number): Promise<Discovery[]> {
    return this.getMany(
      "discovery.getByCategory",
      `${DISCOVERY_SELECT} WHERE category_id = $1 ORDER BY source_order IS NULL, source_order, id`,
      [categoryId],
    );
  }

  async listWithRelations(): Promise<DiscoveryWithRelations[]> {
    return handleDatabaseErrors("discovery.listWithRelations", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<DiscoveryWithRelationsRow[]>(`
        SELECT d.id,
               d.gvdb_id AS gvdbId,
               d.category_id AS categoryId,
               d.name,
               d.rank,
               d.description,
               d.era,
               d.points,
               d.difficulty,
               d.experience,
               d.notes,
               d.source_updated_at AS sourceUpdatedAt,
               d.is_active AS isActive,
               d.raw_row_json AS rawRowJson,
               d.created_at AS createdAt,
               d.updated_at AS updatedAt,
               c.name AS categoryName,
               c.sort_order AS categorySortOrder,
               q.id AS relatedQuestId,
               q.title AS relatedQuestTitle
        FROM discoveries d
        LEFT JOIN discovery_categories c ON c.id = d.category_id
        LEFT JOIN quest_discoveries qd ON qd.discovery_id = d.id
        LEFT JOIN quests q ON q.id = qd.quest_id AND q.is_active = 1
        ORDER BY d.source_order IS NULL, d.source_order, d.id, q.id`);

      const grouped = new Map<number, DiscoveryWithRelations>();
      for (const row of rows) {
        let item = grouped.get(row.id);
        if (!item) {
          item = {
            discovery: mapDiscovery(row),
            category:
              row.categoryId === null || row.categoryName === null
                ? null
                : {
                    id: row.categoryId,
                    name: row.categoryName,
                    sortOrder: row.categorySortOrder ?? 0,
                  },
            relatedQuests: [],
          };
          grouped.set(row.id, item);
        }
        if (row.relatedQuestId !== null && row.relatedQuestTitle !== null) {
          item.relatedQuests.push({
            id: row.relatedQuestId,
            title: row.relatedQuestTitle,
          });
        }
      }
      return [...grouped.values()];
    });
  }

  private async getOne(
    operation: string,
    key: "id" | "gvdb_id",
    value: number,
  ): Promise<Discovery | null> {
    const rows = await this.getMany(
      operation,
      `${DISCOVERY_SELECT} WHERE ${key} = $1`,
      [value],
    );
    return rows[0] ?? null;
  }

  private async getMany(
    operation: string,
    sql: string,
    parameters?: unknown[],
  ): Promise<Discovery[]> {
    return handleDatabaseErrors(operation, async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<DiscoveryRow[]>(sql, parameters);
      return rows.map(mapDiscovery);
    });
  }
}

interface DiscoveryWithRelationsRow extends DiscoveryRow {
  categoryName: string | null;
  categorySortOrder: number | null;
  relatedQuestId: number | null;
  relatedQuestTitle: string | null;
}
