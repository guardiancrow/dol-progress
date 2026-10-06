import { invoke } from "@tauri-apps/api/core";

import type { DatabaseClient, QueryResult } from "./client";

interface DatabaseRequest {
  query: string;
  bindValues: unknown[];
}

class TauriDatabaseClient implements DatabaseClient {
  async execute(query: string, bindValues: unknown[] = []): Promise<QueryResult> {
    return invoke<QueryResult>("database_execute", {
      request: { query, bindValues } satisfies DatabaseRequest,
    });
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    return invoke<T>("database_select", {
      request: { query, bindValues } satisfies DatabaseRequest,
    });
  }
}

const database = new TauriDatabaseClient();

/** Rust initializes the active SQLx pool before the frontend starts. */
export function getDatabase(): Promise<DatabaseClient> {
  return Promise.resolve(database);
}
