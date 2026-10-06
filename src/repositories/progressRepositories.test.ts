import type { QueryResult } from "../db/client";
import { describe, expect, it } from "vitest";

import type { DatabaseClient } from "../db/client";
import { RepositoryError } from "../db/errors";
import { DiscoveryProgressRepository } from "./discoveryProgressRepository";
import { QuestProgressRepository } from "./questProgressRepository";

interface DiscoveryProgressState {
  reported: number;
  cardOwned: number;
  memo: string | null;
}

class ProgressMemoryDatabase implements DatabaseClient {
  readonly profiles = new Set([1, 2]);
  readonly quests = new Set([10]);
  readonly discoveries = new Set([20, 21]);
  readonly questProgress = new Map<string, string | null>();
  readonly discoveryProgress = new Map<string, DiscoveryProgressState>();

  async execute(query: string, parameters: unknown[] = []): Promise<QueryResult> {
    const sql = normalizeSql(query);

    if (sql.startsWith("INSERT INTO quest_progress")) {
      const [profileId, questId] = numberParameters(parameters);
      this.requireReferences(profileId, questId, this.quests);
      const key = progressKey(profileId, questId);
      if (this.questProgress.has(key)) {
        return { rowsAffected: 0 };
      }
      this.questProgress.set(key, null);
      return { rowsAffected: 1 };
    }

    if (sql.startsWith("DELETE FROM quest_progress")) {
      const [profileId, questId] = numberParameters(parameters);
      return {
        rowsAffected: this.questProgress.delete(progressKey(profileId, questId))
          ? 1
          : 0,
      };
    }

    if (sql.startsWith("UPDATE quest_progress")) {
      const memo = nullableString(parameters[0]);
      const profileId = numberParameter(parameters[1]);
      const questId = numberParameter(parameters[2]);
      const key = progressKey(profileId, questId);
      if (!this.questProgress.has(key)) {
        return { rowsAffected: 0 };
      }
      this.questProgress.set(key, memo);
      return { rowsAffected: 1 };
    }

    if (sql.startsWith("INSERT INTO discovery_progress")) {
      const [profileId, discoveryId] = numberParameters(parameters);
      this.requireReferences(profileId, discoveryId, this.discoveries);
      const key = progressKey(profileId, discoveryId);
      if (this.discoveryProgress.has(key)) {
        return { rowsAffected: 0 };
      }
      this.discoveryProgress.set(key, {
        reported: 0,
        cardOwned: 1,
        memo: null,
      });
      return { rowsAffected: 1 };
    }

    if (sql.startsWith("DELETE FROM discovery_progress")) {
      const [profileId, discoveryId] = numberParameters(parameters);
      return {
        rowsAffected: this.discoveryProgress.delete(
          progressKey(profileId, discoveryId),
        )
          ? 1
          : 0,
      };
    }

    if (sql.startsWith("UPDATE discovery_progress")) {
      return this.updateDiscoveryProgress(sql, parameters);
    }

    throw new Error(`Unsupported execute SQL in test: ${sql}`);
  }

  async select<T>(query: string, parameters: unknown[] = []): Promise<T> {
    const sql = normalizeSql(query);

    if (sql.includes("SELECT EXISTS(") && sql.includes("FROM quest_progress")) {
      const [profileId, questId] = numberParameters(parameters);
      return [
        {
          isCompleted: this.questProgress.has(progressKey(profileId, questId))
            ? 1
            : 0,
        },
      ] as T;
    }

    if (sql.startsWith("SELECT quest_id AS id")) {
      const profileId = numberParameter(parameters[0]);
      return this.idsForProfile(this.questProgress, profileId).map((id) => ({ id })) as T;
    }

    if (
      sql.startsWith("SELECT profile_id AS profileId") &&
      sql.includes("FROM discovery_progress")
    ) {
      if (!sql.includes("AND discovery_id = $2")) {
        const profileId = numberParameter(parameters[0]);
        return [...this.discoveryProgress.entries()]
          .filter(([key]) => parseProgressKey(key)[0] === profileId)
          .sort(([left], [right]) => parseProgressKey(left)[1] - parseProgressKey(right)[1])
          .map(([key, state]) => ({
            profileId,
            discoveryId: parseProgressKey(key)[1],
            ...state,
            updatedAt: "2026-01-01T00:00:00.000Z",
          })) as T;
      }
      const [profileId, discoveryId] = numberParameters(parameters);
      const state = this.discoveryProgress.get(
        progressKey(profileId, discoveryId),
      );
      if (!state) {
        return [] as T;
      }
      return [
        {
          profileId,
          discoveryId,
          ...state,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ] as T;
    }

    if (sql.startsWith("SELECT discovery_id AS id")) {
      const profileId = numberParameter(parameters[0]);
      const ids = [...this.discoveryProgress.entries()]
        .filter(([key, state]) => {
          const [entryProfileId] = parseProgressKey(key);
          if (entryProfileId !== profileId) {
            return false;
          }
          if (sql.includes("reported = 0") && state.reported !== 0) {
            return false;
          }
          return !(sql.includes("card_owned = 1") && state.cardOwned !== 1);
        })
        .map(([key]) => parseProgressKey(key)[1])
        .sort((left, right) => left - right)
        .map((id) => ({ id }));
      return ids as T;
    }

    throw new Error(`Unsupported select SQL in test: ${sql}`);
  }

  async invokeCommand<T>(command: string, arguments_: unknown): Promise<T> {
    const request = (arguments_ as { request: { profileId: number; discoveryId: number; value?: boolean } }).request;
    const key = progressKey(request.profileId, request.discoveryId);
    const state = this.discoveryProgress.get(key);
    if (command === "mark_discovery_discovered") {
      this.requireReferences(request.profileId, request.discoveryId, this.discoveries);
      if (!state) this.discoveryProgress.set(key, { reported: 0, cardOwned: 1, memo: null });
      return undefined as T;
    }
    if (!state) throw new Error("Discovery progress was not found");
    if (command === "set_discovery_reported") {
      state.reported = request.value ? 1 : 0;
      return undefined as T;
    }
    if (command === "set_discovery_card_owned") {
      state.cardOwned = request.value ? 1 : 0;
      return undefined as T;
    }
    throw new Error(`Unsupported command in test: ${command}`);
  }

  private updateDiscoveryProgress(
    sql: string,
    parameters: unknown[],
  ): QueryResult {
    const profileId = numberParameter(parameters[1]);
    const discoveryId = numberParameter(parameters[2]);
    const key = progressKey(profileId, discoveryId);
    const state = this.discoveryProgress.get(key);
    if (!state) {
      return { rowsAffected: 0 };
    }

    if (sql.includes("SET reported = $1")) {
      state.reported = numberParameter(parameters[0]);
    } else if (sql.includes("SET card_owned = $1")) {
      state.cardOwned = numberParameter(parameters[0]);
    } else if (sql.includes("SET memo = $1")) {
      state.memo = nullableString(parameters[0]);
    } else {
      throw new Error(`Unsupported discovery update SQL in test: ${sql}`);
    }
    return { rowsAffected: 1 };
  }

  private requireReferences(
    profileId: number,
    masterId: number,
    masters: Set<number>,
  ): void {
    if (!this.profiles.has(profileId) || !masters.has(masterId)) {
      throw new Error("(code: 787) FOREIGN KEY constraint failed");
    }
  }

  private idsForProfile(
    progress: Map<string, string | null>,
    profileId: number,
  ): number[] {
    return [...progress.keys()]
      .map(parseProgressKey)
      .filter(([entryProfileId]) => entryProfileId === profileId)
      .map(([, id]) => id)
      .sort((left, right) => left - right);
  }
}

describe("QuestProgressRepository", () => {
  it("transitions between row absence and row presence idempotently", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = new QuestProgressRepository(async () => database);

    await expect(repository.isCompleted(1, 10)).resolves.toBe(false);
    await repository.markCompleted(1, 10);
    await repository.markCompleted(1, 10);
    await repository.updateMemo(1, 10, "達成メモ");
    await expect(repository.isCompleted(1, 10)).resolves.toBe(true);
    await expect(repository.listCompletedQuestIds(1)).resolves.toEqual([10]);
    expect(database.questProgress.get("1:10")).toBe("達成メモ");
    await repository.markIncomplete(1, 10);
    await repository.markIncomplete(1, 10);
    await expect(repository.isCompleted(1, 10)).resolves.toBe(false);
  });

  it("keeps progress independent per profile", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = new QuestProgressRepository(async () => database);

    await repository.markCompleted(1, 10);

    await expect(repository.isCompleted(1, 10)).resolves.toBe(true);
    await expect(repository.isCompleted(2, 10)).resolves.toBe(false);
  });

  it("maps missing master references to a foreign-key violation", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = new QuestProgressRepository(async () => database);

    const error = await repository
      .markCompleted(1, 999)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).kind).toBe("foreign_key_violation");
  });
});

describe("DiscoveryProgressRepository", () => {
  it("implements the documented discovery, report, and card transitions", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = discoveryRepository(database);

    await expect(repository.get(1, 20)).resolves.toBeNull();
    await repository.markDiscovered(1, 20);
    await repository.updateMemo(1, 20, "発見メモ");
    await expect(repository.get(1, 20)).resolves.toMatchObject({
      reported: false,
      cardOwned: true,
      memo: "発見メモ",
    });

    await repository.setReported(1, 20, true);
    await repository.setCardOwned(1, 20, false);
    await expect(repository.get(1, 20)).resolves.toMatchObject({
      reported: true,
      cardOwned: false,
    });

    await repository.markDiscovered(1, 20);
    await expect(repository.get(1, 20)).resolves.toMatchObject({
      reported: true,
      cardOwned: false,
    });

    await repository.markUndiscovered(1, 20);
    await repository.markUndiscovered(1, 20);
    await expect(repository.get(1, 20)).resolves.toBeNull();
  });

  it("keeps progress independent and filters ids by state", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = discoveryRepository(database);

    await repository.markDiscovered(1, 20);
    await repository.markDiscovered(1, 21);
    await repository.setReported(1, 21, true);
    await repository.setCardOwned(1, 21, false);
    await repository.markDiscovered(2, 20);

    await expect(repository.listDiscoveredIds(1)).resolves.toEqual([20, 21]);
    await expect(repository.listUnreportedIds(1)).resolves.toEqual([20]);
    await expect(repository.listCardOwnedIds(1)).resolves.toEqual([20]);
    await expect(repository.listByProfile(1)).resolves.toEqual([
      expect.objectContaining({ discoveryId: 20, reported: false, cardOwned: true }),
      expect.objectContaining({ discoveryId: 21, reported: true, cardOwned: false }),
    ]);
    await expect(repository.listDiscoveredIds(2)).resolves.toEqual([20]);
  });

  it("rejects missing discovery references and missing progress updates", async () => {
    const database = new ProgressMemoryDatabase();
    const repository = discoveryRepository(database);

    const foreignKeyError = await repository
      .markDiscovered(1, 999)
      .catch((caught: unknown) => caught);
    const notFoundError = await repository
      .setReported(1, 20, true)
      .catch((caught: unknown) => caught);

    expect((foreignKeyError as RepositoryError).kind).toBe(
      "foreign_key_violation",
    );
    expect((notFoundError as RepositoryError).kind).toBe("database");
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function discoveryRepository(database: ProgressMemoryDatabase): DiscoveryProgressRepository {
  return new DiscoveryProgressRepository(
    async () => database,
    database.invokeCommand.bind(database),
  );
}

function progressKey(profileId: number, entityId: number): string {
  return `${profileId}:${entityId}`;
}

function parseProgressKey(key: string): [number, number] {
  const [profileId, entityId] = key.split(":").map(Number);
  if (profileId === undefined || entityId === undefined) {
    throw new Error(`Invalid progress key: ${key}`);
  }
  return [profileId, entityId];
}

function numberParameters(parameters: unknown[]): [number, number] {
  return [numberParameter(parameters[0]), numberParameter(parameters[1])];
}

function numberParameter(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("Expected a numeric bind parameter");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }
  throw new Error("Expected a nullable string bind parameter");
}
