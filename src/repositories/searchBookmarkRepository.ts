import type { DatabaseProvider } from "../db/client";
import { getDatabase } from "../db/connection";
import { entityNotFound, handleDatabaseErrors, mapDatabaseError, RepositoryError } from "../db/errors";
import {
  blocked, decodeSearchCondition, type ConditionResult, type SearchConditionDefinition,
} from "../searchConditions/definition";

export interface SearchBookmark {
  id: number;
  page: SearchConditionDefinition["page"];
  name: string;
  definition: ConditionResult<SearchConditionDefinition>;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

type BookmarkErrorKind = "invalid_name" | "invalid_condition" | "wrong_page" | "duplicate_name" | "bookmark_limit" | "favorite_limit";

export class SearchBookmarkError extends Error {
  constructor(readonly kind: BookmarkErrorKind) {
    super(kind);
    this.name = "SearchBookmarkError";
  }
}

interface BookmarkRow extends Omit<SearchBookmark, "definition" | "isFavorite"> {
  definitionJson: string;
  isFavorite: number;
}

const COLUMNS = `id, page, name, definition_json AS definitionJson, is_favorite AS isFavorite,
                 created_at AS createdAt, updated_at AS updatedAt, last_used_at AS lastUsedAt`;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export class SearchBookmarkRepository {
  constructor(private readonly databaseProvider: DatabaseProvider = getDatabase) {}

  async list(): Promise<SearchBookmark[]> {
    return handleDatabaseErrors("searchBookmark.list", async () => {
      const database = await this.databaseProvider();
      const rows = await database.select<BookmarkRow[]>(
        `SELECT ${COLUMNS} FROM search_bookmarks
         ORDER BY is_favorite DESC, last_used_at DESC, created_at DESC, id DESC`,
      );
      return rows.map(mapBookmark);
    });
  }

  async getById(id: number): Promise<SearchBookmark | null> {
    return handleDatabaseErrors("searchBookmark.getById", async () => {
      const database = await this.databaseProvider();
      const [row] = await database.select<BookmarkRow[]>(`SELECT ${COLUMNS} FROM search_bookmarks WHERE id = $1`, [id]);
      return row ? mapBookmark(row) : null;
    });
  }

  async create(name: string, definition: unknown, isFavorite = false): Promise<SearchBookmark> {
    const condition = requireDefinition(definition);
    return this.write("searchBookmark.create",
      "INSERT INTO search_bookmarks (page, name, definition_json, is_favorite) VALUES ($1, $2, $3, $4)",
      [condition.page, normalizeName(name), JSON.stringify(condition), isFavorite ? 1 : 0]);
  }

  async rename(id: number, name: string): Promise<SearchBookmark> {
    return this.write("searchBookmark.rename",
      `UPDATE search_bookmarks SET name = $1, updated_at = ${NOW} WHERE id = $2`, [normalizeName(name), id], id);
  }

  async updateCondition(id: number, definition: unknown): Promise<SearchBookmark> {
    const condition = requireDefinition(definition);
    return this.write("searchBookmark.updateCondition",
      `UPDATE search_bookmarks SET definition_json = $1, updated_at = ${NOW} WHERE id = $2`, [JSON.stringify(condition), id], id);
  }

  async setFavorite(id: number, isFavorite: boolean): Promise<SearchBookmark> {
    return this.write("searchBookmark.setFavorite",
      `UPDATE search_bookmarks SET is_favorite = $1, updated_at = ${NOW} WHERE id = $2`, [isFavorite ? 1 : 0, id], id);
  }

  async markUsed(id: number): Promise<SearchBookmark> {
    return this.write("searchBookmark.markUsed",
      `UPDATE search_bookmarks SET last_used_at = ${NOW} WHERE id = $1`, [id], id);
  }

  async delete(id: number): Promise<void> {
    const operation = "searchBookmark.delete";
    return handleDatabaseErrors(operation, async () => {
      const database = await this.databaseProvider();
      const result = await database.execute("DELETE FROM search_bookmarks WHERE id = $1", [id]);
      if (result.rowsAffected === 0) throw entityNotFound(operation, "Search bookmark", id);
    });
  }

  private async write(operation: string, statement: string, parameters: unknown[], id?: number): Promise<SearchBookmark> {
    try {
      const database = await this.databaseProvider();
      // RETURNING reads the mutation result in the same SQLite statement and transaction.
      const [row] = await database.select<BookmarkRow[]>(`${statement} RETURNING ${COLUMNS}`, parameters);
      if (row) return mapBookmark(row);
      if (id !== undefined) throw entityNotFound(operation, "Search bookmark", id);
      throw new RepositoryError("database", operation, "SQLite did not return the created search bookmark");
    } catch (error: unknown) {
      const failure = mapDatabaseError(error, operation);
      const message = failure.message;
      if (message.includes("search_bookmark_favorite_limit")) throw new SearchBookmarkError("favorite_limit");
      if (message.includes("search_bookmark_limit")) throw new SearchBookmarkError("bookmark_limit");
      if (message.includes("UNIQUE constraint failed: search_bookmarks.page, search_bookmarks.name")) {
        throw new SearchBookmarkError("duplicate_name");
      }
      if (message.includes("CHECK constraint failed: search_bookmarks_definition_page")) {
        throw new SearchBookmarkError("wrong_page");
      }
      throw failure;
    }
  }
}

function normalizeName(input: string): string {
  const name = input.trim();
  if (name === "" || name.includes("\0")) throw new SearchBookmarkError("invalid_name");
  return name;
}

function requireDefinition(input: unknown): SearchConditionDefinition {
  const definition = decodeSearchCondition(input);
  if (definition.status === "blocked") throw new SearchBookmarkError("invalid_condition");
  return definition.value;
}

function readDefinition(json: string, page: SearchBookmark["page"]): SearchBookmark["definition"] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return blocked("invalid", "definition");
  }
  const definition = decodeSearchCondition(value);
  return definition.status === "ready" && definition.value.page !== page ? blocked("invalid", "page") : definition;
}

function mapBookmark({ definitionJson, isFavorite, ...row }: BookmarkRow): SearchBookmark {
  return { ...row, isFavorite: isFavorite === 1, definition: readDefinition(definitionJson, row.page) };
}
