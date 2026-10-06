import { invoke } from "@tauri-apps/api/core";

import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { entityNotFound, handleDatabaseErrors } from "../db/errors";
import type { DiscoveryProgress } from "../domain/models";
import {
  type DiscoveryProgressRow,
  type EntityIdRow,
  mapDiscoveryProgress,
} from "./mappers";

const DISCOVERY_PROGRESS_SELECT = `
  SELECT profile_id AS profileId,
         discovery_id AS discoveryId,
         reported,
         card_owned AS cardOwned,
         memo,
         updated_at AS updatedAt
  FROM discovery_progress`;

export class DiscoveryProgressRepository {
  constructor(
    private readonly databaseProvider: DatabaseProvider = getDatabase,
    private readonly invokeCommand: typeof invoke = invoke,
  ) {}

  async get(
    profileId: number,
    discoveryId: number,
  ): Promise<DiscoveryProgress | null> {
    return handleDatabaseErrors("discoveryProgress.get", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<DiscoveryProgressRow[]>(
        `${DISCOVERY_PROGRESS_SELECT}
         WHERE profile_id = $1 AND discovery_id = $2`,
        [profileId, discoveryId],
      );
      return rows[0] ? mapDiscoveryProgress(rows[0]) : null;
    });
  }

  async markDiscovered(profileId: number, discoveryId: number): Promise<void> {
    return handleDatabaseErrors("discoveryProgress.markDiscovered", async () => {
      await this.invokeCommand("mark_discovery_discovered", {
        request: { profileId, discoveryId },
      });
    });
  }

  async markUndiscovered(
    profileId: number,
    discoveryId: number,
  ): Promise<void> {
    return handleDatabaseErrors(
      "discoveryProgress.markUndiscovered",
      async () => {
        const database = await this.databaseProvider();
        await database.execute(
          `DELETE FROM discovery_progress
           WHERE profile_id = $1 AND discovery_id = $2`,
          [profileId, discoveryId],
        );
      },
    );
  }

  async setReported(
    profileId: number,
    discoveryId: number,
    reported: boolean,
  ): Promise<void> {
    return this.updateFlag(
      "discoveryProgress.setReported",
      "set_discovery_reported",
      profileId,
      discoveryId,
      reported,
    );
  }

  async setCardOwned(
    profileId: number,
    discoveryId: number,
    cardOwned: boolean,
  ): Promise<void> {
    return this.updateFlag(
      "discoveryProgress.setCardOwned",
      "set_discovery_card_owned",
      profileId,
      discoveryId,
      cardOwned,
    );
  }

  async updateMemo(
    profileId: number,
    discoveryId: number,
    memo: string | null,
  ): Promise<void> {
    return handleDatabaseErrors("discoveryProgress.updateMemo", async () => {
      const database = await this.databaseProvider();
      const result = await database.execute(
        `UPDATE discovery_progress
         SET memo = $1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE profile_id = $2 AND discovery_id = $3`,
        [memo, profileId, discoveryId],
      );
      this.requireExistingProgress(
        result.rowsAffected,
        "discoveryProgress.updateMemo",
        discoveryId,
      );
    });
  }

  async listDiscoveredIds(profileId: number): Promise<number[]> {
    return this.listIds("discoveryProgress.listDiscoveredIds", profileId);
  }

  async listByProfile(profileId: number): Promise<DiscoveryProgress[]> {
    return handleDatabaseErrors("discoveryProgress.listByProfile", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<DiscoveryProgressRow[]>(
        `${DISCOVERY_PROGRESS_SELECT}
         WHERE profile_id = $1
         ORDER BY discovery_id`,
        [profileId],
      );
      return rows.map(mapDiscoveryProgress);
    });
  }

  async listUnreportedIds(profileId: number): Promise<number[]> {
    return this.listIds(
      "discoveryProgress.listUnreportedIds",
      profileId,
      "reported = 0",
    );
  }

  async listCardOwnedIds(profileId: number): Promise<number[]> {
    return this.listIds(
      "discoveryProgress.listCardOwnedIds",
      profileId,
      "card_owned = 1",
    );
  }

  private async updateFlag(
    operation: string,
    command: "set_discovery_reported" | "set_discovery_card_owned",
    profileId: number,
    discoveryId: number,
    value: boolean,
  ): Promise<void> {
    return handleDatabaseErrors(operation, async () => {
      await this.invokeCommand(command, {
        request: { profileId, discoveryId, value },
      });
    });
  }

  private async listIds(
    operation: string,
    profileId: number,
    condition?: "reported = 0" | "card_owned = 1",
  ): Promise<number[]> {
    return handleDatabaseErrors(operation, async () => {
      const database = await this.databaseProvider();
      const conditionSql = condition ? ` AND ${condition}` : "";
      const rows = await database.select<EntityIdRow[]>(
        `SELECT discovery_id AS id
         FROM discovery_progress
         WHERE profile_id = $1${conditionSql}
         ORDER BY discovery_id`,
        [profileId],
      );
      return rows.map((row) => row.id);
    });
  }

  private requireExistingProgress(
    rowsAffected: number,
    operation: string,
    discoveryId: number,
  ): void {
    if (rowsAffected === 0) {
      throw entityNotFound(operation, "Discovery progress", discoveryId);
    }
  }
}
