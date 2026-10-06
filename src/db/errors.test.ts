import { describe, expect, it } from "vitest";

import { entityNotFound, mapDatabaseError } from "./errors";

describe("RepositoryError", () => {
  it("distinguishes not-found errors", () => {
    const error = entityNotFound("profile.update", "Profile", 42);
    expect(error.kind).toBe("not_found");
    expect(error.operation).toBe("profile.update");
  });

  it("distinguishes SQLite foreign-key violations", () => {
    const error = mapDatabaseError(
      "error returned from database: (code: 787) FOREIGN KEY constraint failed",
      "questProgress.markCompleted",
    );
    expect(error.kind).toBe("foreign_key_violation");
  });

  it("classifies other SQL errors as database errors", () => {
    const error = mapDatabaseError(
      new Error("database is locked"),
      "profile.list",
    );
    expect(error.kind).toBe("database");
    expect(error.originalError).toBeInstanceOf(Error);
  });
});
