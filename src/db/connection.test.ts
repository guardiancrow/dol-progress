import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("getDatabase", () => {
  it("keeps one adapter while forwarding SELECT requests with bound parameters", async () => {
    invoke.mockResolvedValueOnce([{ id: 1, name: "Profile A" }]);
    const { getDatabase } = await import("./connection");

    const [first, second] = await Promise.all([getDatabase(), getDatabase()]);
    expect(first).toBe(second);
    await expect(first.select("SELECT id, name FROM profiles WHERE id = ?", [1]))
      .resolves.toEqual([{ id: 1, name: "Profile A" }]);
    expect(invoke).toHaveBeenCalledWith("database_select", {
      request: {
        query: "SELECT id, name FROM profiles WHERE id = ?",
        bindValues: [1],
      },
    });
  });

  it("forwards execute requests and preserves affected-row and insert-id results", async () => {
    invoke.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 8 });
    const { getDatabase } = await import("./connection");

    const database = await getDatabase();
    await expect(database.execute("INSERT INTO profiles (name) VALUES (?)", ["Profile A"]))
      .resolves.toEqual({ rowsAffected: 1, lastInsertId: 8 });
    expect(invoke).toHaveBeenCalledWith("database_execute", {
      request: {
        query: "INSERT INTO profiles (name) VALUES (?)",
        bindValues: ["Profile A"],
      },
    });
  });
});
