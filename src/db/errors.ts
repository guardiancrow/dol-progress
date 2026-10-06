export type RepositoryErrorKind =
  | "not_found"
  | "foreign_key_violation"
  | "database";

export class RepositoryError extends Error {
  readonly kind: RepositoryErrorKind;
  readonly operation: string;
  readonly originalError: unknown;

  constructor(
    kind: RepositoryErrorKind,
    operation: string,
    message: string,
    originalError?: unknown,
  ) {
    super(message);
    this.name = "RepositoryError";
    this.kind = kind;
    this.operation = operation;
    this.originalError = originalError;
  }
}

export function entityNotFound(
  operation: string,
  entity: string,
  id: number,
): RepositoryError {
  return new RepositoryError(
    "not_found",
    operation,
    `${entity} was not found: ${id}`,
  );
}

export function mapDatabaseError(
  error: unknown,
  operation: string,
): RepositoryError {
  if (error instanceof RepositoryError) {
    return error;
  }

  const message = errorMessage(error);
  const kind = isForeignKeyViolation(message)
    ? "foreign_key_violation"
    : "database";

  return new RepositoryError(kind, operation, message, error);
}

export async function handleDatabaseErrors<T>(
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    throw mapDatabaseError(error, operation);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown database error";
}

function isForeignKeyViolation(message: string): boolean {
  return /FOREIGN KEY constraint failed|SQLITE_CONSTRAINT_FOREIGNKEY|code:\s*787/i.test(
    message,
  );
}
