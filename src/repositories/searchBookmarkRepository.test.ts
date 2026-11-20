import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../src-tauri/migrations/005_search_bookmarks.sql?raw";
import type { DatabaseClient } from "../db/client";
import type { DiscoverySearchCondition, QuestSearchCondition } from "../searchConditions/definition";
import { SearchBookmarkRepository } from "./searchBookmarkRepository";

interface MemorySqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
  close(): void;
}

const sqliteModule = "node:sqlite";
const sqlite = await import(/* @vite-ignore */ sqliteModule).catch(() => null) as
  { DatabaseSync: new (path: string) => MemorySqlite } | null;

const quest: QuestSearchCondition = {
  schemaVersion: 1, page: "quests", search: "探検", filters: { completed: false, progressReview: true, requiredSkills: "探索" },
  sorting: [{ key: "requiredSkillRank", direction: "desc" }],
};
const discovery: DiscoverySearchCondition = {
  schemaVersion: 1, page: "discoveries", search: "史跡", filters: { mapReacquisition: "related", cardOwned: false }, sorting: [],
};

describe.skipIf(sqlite === null)("SQLite search bookmark repository", () => {
  let database: MemorySqlite;
  let repository: SearchBookmarkRepository;

  beforeEach(() => {
    database = new sqlite!.DatabaseSync(":memory:");
    database.exec(schema);
    const namedParameters = (parameters: unknown[]) => Object.fromEntries(parameters.map((value, index) => [String(index + 1), value]));
    const client: DatabaseClient = {
      async select<T>(query: string, parameters: unknown[] = []): Promise<T> {
        const statement = database.prepare(query);
        return (parameters.length ? statement.all(namedParameters(parameters)) : statement.all()) as T;
      },
      async execute(query, parameters = []) {
        return { rowsAffected: database.prepare(query).run(namedParameters(parameters)).changes };
      },
    };
    repository = new SearchBookmarkRepository(async () => client);
  });

  afterEach(() => database.close());

  it("creates, lists, renames, explicitly replaces conditions, marks usage, and deletes by stable ID", async () => {
    const created = await repository.create("\t　地図 ' A\u00a0", quest);
    expect(created).toMatchObject({
      name: "地図 ' A", page: "quests", definition: { status: "ready", value: quest },
      isFavorite: false, lastUsedAt: null,
    });
    expect(created.updatedAt).toBe(created.createdAt);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);

    database.exec("UPDATE search_bookmarks SET updated_at = '2000-01-01T00:00:00.000Z'");
    const renamed = await repository.rename(created.id, "　依頼A ");
    expect(renamed).toMatchObject({ name: "依頼A", id: created.id, createdAt: created.createdAt, definition: created.definition });
    expect(renamed.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    const revised = await repository.updateCondition(created.id, { ...quest, search: "別の文字列", filters: {}, sorting: [] });
    expect(revised).toMatchObject({ name: "依頼A", id: created.id, definition: { status: "ready", value: { ...quest, search: "別の文字列", filters: {}, sorting: [] } } });
    const used = await repository.markUsed(created.id);
    expect(used.lastUsedAt).toMatch(/Z$/);
    expect(used.updatedAt).toBe(revised.updatedAt);
    expect((await repository.list())[0]).toEqual(used);
    await repository.delete(created.id);
    expect(await repository.getById(created.id)).toBeNull();
    await expect(repository.delete(created.id)).rejects.toMatchObject({ kind: "not_found" });
    await expect(repository.rename(created.id, "削除済み")).rejects.toMatchObject({ kind: "not_found" });
    expect((await repository.create("依頼A", quest)).id).toBeGreaterThan(created.id);
  });

  it("enforces normalized names per page and reports rejected writes without changing the row", async () => {
    const original = await repository.create("共通名", quest);
    await repository.create("共通名", discovery);
    const another = await repository.create("別の名前", quest);
    await expect(repository.create("\n　共通名\t", quest)).rejects.toMatchObject({ kind: "duplicate_name" });
    await expect(repository.rename(another.id, "　共通名")).rejects.toMatchObject({ kind: "duplicate_name" });
    await expect(repository.rename(original.id, "　\uFEFF\t")).rejects.toMatchObject({ kind: "invalid_name" });
    await expect(repository.create("名称\0", discovery)).rejects.toMatchObject({ kind: "invalid_name" });
    await expect(repository.updateCondition(original.id, discovery)).rejects.toMatchObject({ kind: "wrong_page" });
    await expect(repository.updateCondition(original.id, { ...quest, filters: { completed: "false" } })).rejects.toMatchObject({ kind: "invalid_condition" });
    await expect(repository.create("将来形式", { ...quest, schemaVersion: 2 })).rejects.toMatchObject({ kind: "invalid_condition" });
    expect(await repository.getById(original.id)).toEqual(original);
    expect(await repository.getById(another.id)).toEqual(another);
    expect(await repository.list()).toHaveLength(3);
  });

  it("enforces combined limits and leaves explicit edits and freeing a slot available at capacity", async () => {
    const bookmarks = [];
    for (let i = 0; i < 50; i++) {
      bookmarks.push(await repository.create(`合成 ${i}`, i % 2 ? quest : discovery, i < 5));
    }
    await expect(repository.create("51件目", discovery)).rejects.toMatchObject({ kind: "bookmark_limit" });
    await expect(repository.setFavorite(bookmarks[5]!.id, true)).rejects.toMatchObject({ kind: "favorite_limit" });
    expect(await repository.setFavorite(bookmarks[0]!.id, true)).toMatchObject({ isFavorite: true });
    expect(await repository.rename(bookmarks[5]!.id, "名前変更")).toMatchObject({ name: "名前変更" });
    await repository.delete(bookmarks[49]!.id);
    await expect(repository.create("6件目のお気に入り", quest, true)).rejects.toMatchObject({ kind: "favorite_limit" });
    await repository.setFavorite(bookmarks[0]!.id, false);
    expect(await repository.create("空いた枠", discovery, true)).toMatchObject({ isFavorite: true });
    const rows = await repository.list();
    expect(rows).toHaveLength(50);
    expect(rows.slice(0, 5).every(row => row.isFavorite)).toBe(true);
    expect(rows.slice(5).every(row => !row.isFavorite)).toBe(true);
  });

  it("lists unsupported or invalid definitions individually and preserves the stored JSON when renaming", async () => {
    const current = await repository.create("対応済み", quest);
    const futureJson = JSON.stringify({ page: "quests", schemaVersion: 2, newOptions: [1, 2] });
    database.prepare("INSERT INTO search_bookmarks (page, name, definition_json) VALUES ('quests', '将来形式', ?)").run(futureJson);
    database.prepare("INSERT INTO search_bookmarks (page, name, definition_json) VALUES ('quests', '未知の条件', ?)")
      .run(JSON.stringify({ ...quest, filters: { unknown: true } }));
    const rows = await repository.list();
    expect(rows).toContainEqual(current);
    const future = rows.find(row => row.name === "将来形式")!;
    expect(future.definition).toMatchObject({ status: "blocked", issue: { kind: "unsupported-version" } });
    expect(rows.find(row => row.name === "未知の条件")?.definition).toMatchObject({ status: "blocked", issue: { field: "unknown" } });
    await repository.rename(future.id, "将来形式の名前を変更");
    expect(database.prepare("SELECT definition_json FROM search_bookmarks WHERE id = ?").all(future.id)).toEqual([{ definition_json: futureJson }]);
  });
});
