import type { DatabaseClient, QueryResult } from "../db/client";

export interface DatabaseCall {
  sql: string;
  parameters: unknown[] | undefined;
}

export class StubDatabase implements DatabaseClient {
  readonly executeCalls: DatabaseCall[] = [];
  readonly selectCalls: DatabaseCall[] = [];
  readonly executeResults: QueryResult[] = [];
  readonly selectResults: unknown[] = [];
  executeError: unknown;
  selectError: unknown;

  async execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<QueryResult> {
    this.executeCalls.push({ sql: query, parameters: bindValues });
    if (this.executeError !== undefined) {
      throw this.executeError;
    }
    return this.executeResults.shift() ?? { rowsAffected: 0 };
  }

  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    this.selectCalls.push({ sql: query, parameters: bindValues });
    if (this.selectError !== undefined) {
      throw this.selectError;
    }
    return (this.selectResults.shift() ?? []) as T;
  }
}
