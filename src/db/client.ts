export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface DatabaseClient {
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export type DatabaseProvider = () => Promise<DatabaseClient>;
