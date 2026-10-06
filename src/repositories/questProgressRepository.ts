import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { entityNotFound, handleDatabaseErrors } from "../db/errors";
import type { EntityIdRow } from "./mappers";

interface CompletionRow {
  isCompleted: number;
}

export class QuestProgressRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async isCompleted(profileId: number, questId: number): Promise<boolean> {
    return handleDatabaseErrors("questProgress.isCompleted", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<CompletionRow[]>(
        `SELECT EXISTS(
           SELECT 1 FROM quest_progress
           WHERE profile_id = $1 AND quest_id = $2
         ) AS isCompleted`,
        [profileId, questId],
      );
      return rows[0]?.isCompleted === 1;
    });
  }

  async markCompleted(profileId: number, questId: number): Promise<void> {
    return handleDatabaseErrors("questProgress.markCompleted", async () => {
      const database = await this.databaseProvider();
      await database.execute(
        `INSERT INTO quest_progress (profile_id, quest_id)
         VALUES ($1, $2)
         ON CONFLICT(profile_id, quest_id) DO NOTHING`,
        [profileId, questId],
      );
    });
  }

  async markIncomplete(profileId: number, questId: number): Promise<void> {
    return handleDatabaseErrors("questProgress.markIncomplete", async () => {
      const database = await this.databaseProvider();
      await database.execute(
        "DELETE FROM quest_progress WHERE profile_id = $1 AND quest_id = $2",
        [profileId, questId],
      );
    });
  }

  async listCompletedQuestIds(profileId: number): Promise<number[]> {
    return handleDatabaseErrors(
      "questProgress.listCompletedQuestIds",
      async () => {
        const database = await this.databaseProvider();
        const rows = await database.select<EntityIdRow[]>(
          `SELECT quest_id AS id
           FROM quest_progress
           WHERE profile_id = $1
           ORDER BY quest_id`,
          [profileId],
        );
        return rows.map((row) => row.id);
      },
    );
  }

  async updateMemo(
    profileId: number,
    questId: number,
    memo: string | null,
  ): Promise<void> {
    return handleDatabaseErrors("questProgress.updateMemo", async () => {
      const database = await this.databaseProvider();
      const result = await database.execute(
        `UPDATE quest_progress
         SET memo = $1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE profile_id = $2 AND quest_id = $3`,
        [memo, profileId, questId],
      );
      if (result.rowsAffected === 0) {
        throw entityNotFound(
          "questProgress.updateMemo",
          "Quest progress",
          questId,
        );
      }
    });
  }
}
