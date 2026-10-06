import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { handleDatabaseErrors } from "../db/errors";
import type { Quest, QuestWithDiscoveries } from "../domain/models";
import type { QuestDependency } from "../quests/prerequisites";
import { mapQuest, type QuestRow } from "./mappers";

const QUEST_SELECT = `
  SELECT id,
         gvdb_id AS gvdbId,
         title,
         difficulty,
         chrono_quest AS chronoQuest,
         offer_method AS offerMethod,
         offer_city AS offerCity,
         required_skills AS requiredSkills,
         discovery_type_text AS discoveryTypeText,
         reward_items AS rewardItems,
         notes,
         chain_name AS chainName,
         chain_order AS chainOrder,
         source_updated_at AS sourceUpdatedAt,
         is_active AS isActive,
         raw_row_json AS rawRowJson,
         created_at AS createdAt,
         updated_at AS updatedAt
  FROM quests`;

interface QuestWithDiscoveryRow extends QuestRow {
  discoveryId: number | null;
  discoveryName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySortOrder: number | null;
}

interface QuestRequiredSkillRow {
  questId: number;
  position: number;
  skillName: string;
  requiredRank: number | null;
  isLanguage: number;
}

interface QuestOfferCityRow {
  questId: number;
  position: number;
  cityName: string;
}

export class QuestRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async getById(questId: number): Promise<Quest | null> {
    return this.getOne("quest.getById", "id", questId);
  }

  async getByGvdbId(gvdbId: number): Promise<Quest | null> {
    return this.getOne("quest.getByGvdbId", "gvdb_id", gvdbId);
  }

  async list(): Promise<Quest[]> {
    return handleDatabaseErrors("quest.list", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<QuestRow[]>(
        `${QUEST_SELECT} ORDER BY source_order IS NULL, source_order, id`,
      );
      return rows.map(mapQuest);
    });
  }

  async listWithDiscoveries(): Promise<QuestWithDiscoveries[]> {
    return handleDatabaseErrors("quest.listWithDiscoveries", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<QuestWithDiscoveryRow[]>(
        `SELECT q.id,
                q.gvdb_id AS gvdbId,
                q.title,
                q.difficulty,
                q.chrono_quest AS chronoQuest,
                q.offer_method AS offerMethod,
                q.offer_city AS offerCity,
                q.required_skills AS requiredSkills,
                q.discovery_type_text AS discoveryTypeText,
                q.reward_items AS rewardItems,
                q.notes,
                q.chain_name AS chainName,
                q.chain_order AS chainOrder,
                q.source_updated_at AS sourceUpdatedAt,
                q.is_active AS isActive,
                q.raw_row_json AS rawRowJson,
                q.created_at AS createdAt,
                q.updated_at AS updatedAt,
                d.id AS discoveryId,
                d.name AS discoveryName,
                c.id AS categoryId,
                c.name AS categoryName,
                c.sort_order AS categorySortOrder
           FROM quests q
           LEFT JOIN quest_discoveries qd ON qd.quest_id = q.id
           LEFT JOIN discoveries d ON d.id = qd.discovery_id
           LEFT JOIN discovery_categories c ON c.id = d.category_id
          ORDER BY q.source_order IS NULL, q.source_order, q.id, d.id`,
      );
      const skillRows = await database.select<QuestRequiredSkillRow[]>(
        `SELECT quest_id AS questId, position, skill_name AS skillName,
                required_rank AS requiredRank, is_language AS isLanguage
           FROM quest_required_skills
          ORDER BY quest_id, position`,
      );
      const cityRows = await database.select<QuestOfferCityRow[]>(
        `SELECT quest_id AS questId, position, city_name AS cityName
           FROM quest_offer_cities
          ORDER BY quest_id, position`,
      );

      const grouped = new Map<number, QuestWithDiscoveries>();
      for (const row of rows) {
        let item = grouped.get(row.id);
        if (!item) {
          item = {
            quest: mapQuest(row),
            discoveries: [],
            requiredSkillsNormalized: [],
            offerCities: [],
          };
          grouped.set(row.id, item);
        }
        if (row.discoveryId !== null && row.discoveryName !== null) {
          item.discoveries.push({
            id: row.discoveryId,
            name: row.discoveryName,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            categorySortOrder: row.categorySortOrder,
          });
        }
      }
      for (const row of skillRows) {
        grouped.get(row.questId)?.requiredSkillsNormalized.push({
          position: row.position,
          skillName: row.skillName,
          requiredRank: row.requiredRank,
          isLanguage: row.isLanguage === 1,
        });
      }
      for (const row of cityRows) {
        grouped.get(row.questId)?.offerCities.push({
          position: row.position,
          cityName: row.cityName,
        });
      }
      return [...grouped.values()];
    });
  }

  async listDependencies(): Promise<QuestDependency[]> {
    return handleDatabaseErrors("quest.listDependencies", async () => {
      const database = await this.databaseProvider();
      return database.select<QuestDependency[]>(
        `SELECT quest_id AS questId, prerequisite_quest_id AS prerequisiteQuestId
           FROM quest_dependencies`,
      );
    });
  }

  async searchByTitle(query: string): Promise<Quest[]> {
    return handleDatabaseErrors("quest.searchByTitle", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<QuestRow[]>(
        `${QUEST_SELECT} WHERE instr(title, $1) > 0 ORDER BY source_order IS NULL, source_order, id`,
        [query],
      );
      return rows.map(mapQuest);
    });
  }

  private async getOne(
    operation: string,
    key: "id" | "gvdb_id",
    value: number,
  ): Promise<Quest | null> {
    return handleDatabaseErrors(operation, async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<QuestRow[]>(
        `${QUEST_SELECT} WHERE ${key} = $1`,
        [value],
      );
      return rows[0] ? mapQuest(rows[0]) : null;
    });
  }
}
