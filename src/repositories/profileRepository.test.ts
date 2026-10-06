import { describe, expect, it } from "vitest";

import { RepositoryError } from "../db/errors";
import { StubDatabase } from "../test/stubDatabase";
import { ProfileRepository } from "./profileRepository";

const profileRow = {
  id: 1,
  name: "航海者",
  memo: "メモ",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ProfileRepository", () => {
  it("creates and reads a profile with bound parameters", async () => {
    const database = new StubDatabase();
    database.executeResults.push({ rowsAffected: 1, lastInsertId: 1 });
    database.selectResults.push([profileRow]);
    const repository = new ProfileRepository(async () => database);

    await expect(repository.create("航海者", "メモ")).resolves.toEqual(profileRow);
    expect(database.executeCalls[0]?.parameters).toEqual(["航海者", "メモ"]);
    expect(database.selectCalls[0]?.parameters).toEqual([1]);
  });

  it("updates updated_at explicitly and reports missing profiles", async () => {
    const database = new StubDatabase();
    database.executeResults.push({ rowsAffected: 0 });
    const repository = new ProfileRepository(async () => database);

    const error = await repository
      .update(99, { name: "不存在", memo: null })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).kind).toBe("not_found");
    expect(database.executeCalls[0]?.sql).toContain("updated_at = strftime");
    expect(database.executeCalls[0]?.parameters).toEqual(["不存在", null, 99]);
  });

  it("uses the database cascade when deleting a profile", async () => {
    const database = new StubDatabase();
    database.executeResults.push({ rowsAffected: 1 });
    const repository = new ProfileRepository(async () => database);

    await repository.delete(1);

    expect(database.executeCalls).toHaveLength(1);
    expect(database.executeCalls[0]?.sql).toContain("DELETE FROM profiles");
    expect(database.executeCalls[0]?.parameters).toEqual([1]);
  });
});
