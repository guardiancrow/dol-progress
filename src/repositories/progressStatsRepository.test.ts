import { describe, expect, it } from "vitest";

import { StubDatabase } from "../test/stubDatabase";
import { ProgressStatsRepository } from "./progressStatsRepository";

describe("ProgressStatsRepository", () => {
  it("maps quest, discovery, category, and adventure merit aggregates", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 8, completed: 3 }],
      [
        { scope: "total", categoryId: null, categoryName: null, sortOrder: null, total: 10, discovered: 6, unreported: 2, reported: 4, cardOwned: 5, cardCapableDiscovered: 6, canReport: null, hasCard: null },
        { scope: "category", categoryId: 2, categoryName: "地理", sortOrder: 1, total: 6, discovered: 4, unreported: 1, reported: 3, cardOwned: 4, cardCapableDiscovered: 4, canReport: 1, hasCard: 1 },
        { scope: "category", categoryId: 3, categoryName: "史跡", sortOrder: 2, total: 4, discovered: 2, unreported: 1, reported: 1, cardOwned: 1, cardCapableDiscovered: 2, canReport: 1, hasCard: 1 },
      ],
      [{ knownMerit: 350, reportedCount: 2, knownExperienceCount: 2, unknownExperienceCount: 0 }],
    );
    const repository = new ProgressStatsRepository(async () => database);

    await expect(repository.getForProfile(7)).resolves.toEqual({
      quests: { total: 8, completed: 3, incomplete: 5 },
      discoveries: { total: 10, discovered: 6, undiscovered: 4, unreported: 2, reported: 4, cardOwned: 5, cardCapableDiscovered: 6 },
      adventureMerit: { knownMerit: 350, reportedCount: 2, knownExperienceCount: 2, unknownExperienceCount: 0 },
      categories: [
        { categoryId: 2, categoryName: "地理", sortOrder: 1, total: 6, discovered: 4, undiscovered: 2, unreported: 1, cardOwned: 4, canReport: true, hasCard: true },
        { categoryId: 3, categoryName: "史跡", sortOrder: 2, total: 4, discovered: 2, undiscovered: 2, unreported: 1, cardOwned: 1, canReport: true, hasCard: true },
      ],
    });
  });

  it("uses three parameterized aggregate queries without N+1", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ total: 0, completed: 0 }], []);
    const repository = new ProgressStatsRepository(async () => database);

    await repository.getForProfile(42);

    expect(database.selectCalls).toHaveLength(3);
    expect(database.selectCalls.every((call) => call.parameters?.[0] === 42)).toBe(true);
    expect(database.selectCalls[0]?.sql).toContain("q.is_active = 1");
    expect(database.selectCalls[1]?.sql).toContain("d.is_active = 1");
    expect(database.selectCalls[1]?.sql).toContain("GROUP BY d.category_id");
    expect(database.selectCalls[1]?.sql).toContain("c.name IS NOT 'レリック'");
    expect(database.selectCalls[1]?.sql).not.toContain("42");
    expect(database.selectCalls[2]?.sql).toContain("FROM discovery_progress dp");
    expect(database.selectCalls[2]?.sql).toContain("dp.reported = 1");
    expect(database.selectCalls[2]?.sql).toContain("c.name IS NOT $2");
    expect(database.selectCalls[2]?.sql).not.toContain("d.is_active = 1");
    expect(database.selectCalls[2]?.sql).not.toContain("レリック");
    expect(database.selectCalls[2]?.parameters).toEqual([42, "レリック"]);
    expect(database.executeCalls).toHaveLength(0);
  });

  it("counts only report-capable reported rows while retaining inactive known values", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 0, completed: 0 }],
      [],
      [{ knownMerit: 750, reportedCount: 5, knownExperienceCount: 4, unknownExperienceCount: 1 }],
    );
    const repository = new ProgressStatsRepository(async () => database);

    const result = await repository.getForProfile(1);

    expect(result).toMatchObject({
      adventureMerit: {
        knownMerit: 750,
        reportedCount: 5,
        knownExperienceCount: 4,
        unknownExperienceCount: 1,
      },
    });
    expect(result.adventureMerit.reportedCount).toBe(
      result.adventureMerit.knownExperienceCount + result.adventureMerit.unknownExperienceCount,
    );
  });

  it("treats zero experience as known without changing the merit sum", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 0, completed: 0 }],
      [],
      [{ knownMerit: 100, reportedCount: 2, knownExperienceCount: 2, unknownExperienceCount: 0 }],
    );
    const repository = new ProgressStatsRepository(async () => database);

    await expect(repository.getForProfile(1)).resolves.toMatchObject({
      adventureMerit: {
        knownMerit: 100,
        reportedCount: 2,
        knownExperienceCount: 2,
        unknownExperienceCount: 0,
      },
    });
  });

  it("derives report toggles and master experience changes from each new query", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 500, reportedCount: 1, knownExperienceCount: 1, unknownExperienceCount: 0 }],
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 }],
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 0, reportedCount: 1, knownExperienceCount: 0, unknownExperienceCount: 1 }],
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 500, reportedCount: 1, knownExperienceCount: 1, unknownExperienceCount: 0 }],
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 600, reportedCount: 1, knownExperienceCount: 1, unknownExperienceCount: 0 }],
    );
    const repository = new ProgressStatsRepository(async () => database);

    expect((await repository.getForProfile(1)).adventureMerit).toMatchObject({ knownMerit: 500, reportedCount: 1 });
    expect((await repository.getForProfile(1)).adventureMerit).toMatchObject({ knownMerit: 0, reportedCount: 0 });
    expect((await repository.getForProfile(1)).adventureMerit).toMatchObject({ knownMerit: 0, knownExperienceCount: 0, unknownExperienceCount: 1 });
    expect((await repository.getForProfile(1)).adventureMerit).toMatchObject({ knownMerit: 500, knownExperienceCount: 1, unknownExperienceCount: 0 });
    expect((await repository.getForProfile(1)).adventureMerit).toMatchObject({ knownMerit: 600, knownExperienceCount: 1, unknownExperienceCount: 0 });
  });

  it("keeps adventure merit query results isolated by profile", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 100, reportedCount: 1, knownExperienceCount: 1, unknownExperienceCount: 0 }],
      [{ total: 0, completed: 0 }], [],
      [{ knownMerit: 250, reportedCount: 1, knownExperienceCount: 1, unknownExperienceCount: 0 }],
    );
    const repository = new ProgressStatsRepository(async () => database);

    expect((await repository.getForProfile(1)).adventureMerit.knownMerit).toBe(100);
    expect((await repository.getForProfile(2)).adventureMerit.knownMerit).toBe(250);
    expect(database.selectCalls[2]?.parameters?.[0]).toBe(1);
    expect(database.selectCalls[5]?.parameters?.[0]).toBe(2);
  });

  it("maps relic aggregates as report and card not applicable", async () => {
    const database = new StubDatabase();
    database.selectResults.push(
      [{ total: 0, completed: 0 }],
      [
        { scope: "total", categoryId: null, categoryName: null, sortOrder: null, total: 3, discovered: 2, unreported: 1, reported: 1, cardOwned: 1, cardCapableDiscovered: 1, canReport: null, hasCard: null },
        { scope: "category", categoryId: 20, categoryName: "レリック", sortOrder: 20, total: 2, discovered: 1, unreported: 0, reported: 0, cardOwned: 0, cardCapableDiscovered: 0, canReport: 0, hasCard: 0 },
      ],
    );
    const repository = new ProgressStatsRepository(async () => database);

    await expect(repository.getForProfile(1)).resolves.toMatchObject({
      discoveries: { discovered: 2, unreported: 1, reported: 1, cardOwned: 1, cardCapableDiscovered: 1 },
      categories: [{ categoryName: "レリック", discovered: 1, unreported: 0, cardOwned: 0, canReport: false, hasCard: false }],
    });
  });

  it("returns safe zero values when masters and categories are empty", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ total: 0, completed: 0 }], []);
    const repository = new ProgressStatsRepository(async () => database);

    await expect(repository.getForProfile(1)).resolves.toEqual({
      quests: { total: 0, completed: 0, incomplete: 0 },
      discoveries: { total: 0, discovered: 0, undiscovered: 0, unreported: 0, reported: 0, cardOwned: 0, cardCapableDiscovered: 0 },
      adventureMerit: { knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 },
      categories: [],
    });
  });

  it("excludes inactive quests and their progress before aggregation", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ total: 1, completed: 0 }], [
      { scope: "total", categoryId: null, categoryName: null, sortOrder: null, total: 1, discovered: 0, unreported: 0, reported: 0, cardOwned: 0 },
    ]);
    const repository = new ProgressStatsRepository(async () => database);

    const result = await repository.getForProfile(1);

    expect(result.quests).toEqual({ total: 1, completed: 0, incomplete: 1 });
    expect(database.selectCalls[0]?.sql).toMatch(/FROM quests q[\s\S]*WHERE q\.is_active = 1/);
  });

  it("excludes inactive discoveries before aggregation", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ total: 0, completed: 0 }], [
      { scope: "total", categoryId: null, categoryName: null, sortOrder: null, total: 1, discovered: 0, unreported: 0, reported: 0, cardOwned: 0 },
    ]);
    const repository = new ProgressStatsRepository(async () => database);

    const result = await repository.getForProfile(1);

    expect(result.discoveries).toMatchObject({ total: 1, discovered: 0 });
    expect(database.selectCalls[1]?.sql).toMatch(/FROM discoveries d[\s\S]*WHERE d\.is_active = 1/);
  });

  it("counts progress only after joining it to the active master population", async () => {
    const database = new StubDatabase();
    database.selectResults.push([{ total: 1, completed: 0 }], [
      { scope: "total", categoryId: null, categoryName: null, sortOrder: null, total: 1, discovered: 0, unreported: 0, reported: 0, cardOwned: 0 },
    ]);
    const repository = new ProgressStatsRepository(async () => database);

    await repository.getForProfile(9);

    expect(database.selectCalls[0]?.sql).toMatch(/LEFT JOIN quest_progress qp[\s\S]*WHERE q\.is_active = 1/);
    expect(database.selectCalls[1]?.sql).toMatch(/LEFT JOIN active_progress ap[\s\S]*WHERE d\.is_active = 1/);
  });
});
