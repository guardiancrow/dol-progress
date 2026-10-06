import type { DatabaseClient, DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import {
  entityNotFound,
  handleDatabaseErrors,
  RepositoryError,
} from "../db/errors";
import type { Profile } from "../domain/models";
import { mapProfile, type ProfileRow } from "./mappers";

const PROFILE_SELECT = `
  SELECT id, name, memo,
         created_at AS createdAt,
         updated_at AS updatedAt
  FROM profiles`;

export interface UpdateProfileInput {
  name: string;
  memo: string | null;
}

export class ProfileRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async list(): Promise<Profile[]> {
    return handleDatabaseErrors("profile.list", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<ProfileRow[]>(
        `${PROFILE_SELECT} ORDER BY id`,
      );
      return rows.map(mapProfile);
    });
  }

  async getById(profileId: number): Promise<Profile | null> {
    return handleDatabaseErrors("profile.getById", async () => {
      const database = await this.databaseProvider();
      return this.getByIdWithDatabase(database, profileId);
    });
  }

  async create(name: string, memo?: string | null): Promise<Profile> {
    return handleDatabaseErrors("profile.create", async () => {
      const database = await this.databaseProvider();
      const result = await database.execute(
        "INSERT INTO profiles (name, memo) VALUES ($1, $2)",
        [name, memo ?? null],
      );

      if (result.lastInsertId === undefined) {
        throw new RepositoryError(
          "database",
          "profile.create",
          "SQLite did not return the created profile id",
        );
      }

      const profile = await this.getByIdWithDatabase(
        database,
        result.lastInsertId,
      );
      if (!profile) {
        throw new RepositoryError(
          "database",
          "profile.create",
          "The created profile could not be read",
        );
      }
      return profile;
    });
  }

  async update(profileId: number, input: UpdateProfileInput): Promise<Profile> {
    return handleDatabaseErrors("profile.update", async () => {
      const database = await this.databaseProvider();
      const result = await database.execute(
        `UPDATE profiles
         SET name = $1,
             memo = $2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $3`,
        [input.name, input.memo, profileId],
      );

      if (result.rowsAffected === 0) {
        throw entityNotFound("profile.update", "Profile", profileId);
      }

      const profile = await this.getByIdWithDatabase(database, profileId);
      if (!profile) {
        throw entityNotFound("profile.update", "Profile", profileId);
      }
      return profile;
    });
  }

  async delete(profileId: number): Promise<void> {
    return handleDatabaseErrors("profile.delete", async () => {
      const database = await this.databaseProvider();
      const result = await database.execute(
        "DELETE FROM profiles WHERE id = $1",
        [profileId],
      );
      if (result.rowsAffected === 0) {
        throw entityNotFound("profile.delete", "Profile", profileId);
      }
    });
  }

  private async getByIdWithDatabase(
    database: DatabaseClient,
    profileId: number,
  ): Promise<Profile | null> {
    const rows = await database.select<ProfileRow[]>(
      `${PROFILE_SELECT} WHERE id = $1`,
      [profileId],
    );
    return rows[0] ? mapProfile(rows[0]) : null;
  }
}
