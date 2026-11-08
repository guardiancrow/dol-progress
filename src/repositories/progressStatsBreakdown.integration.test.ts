import { describe, expect, it } from "vitest";
import initial from "../../src-tauri/migrations/001_initial.sql?raw";
import facets from "../../src-tauri/migrations/002_quest_facets.sql?raw";
import sourceOrder from "../../src-tauri/migrations/003_master_source_order.sql?raw";
import history from "../../src-tauri/migrations/004_map_report_hold.sql?raw";
import type { DatabaseClient } from "../db/client";
import type { ProgressStats } from "../overview/types";
import { ProgressStatsRepository } from "./progressStatsRepository";
import { DiscoveryStateReader } from "../discoveries/stateReader";
import { currentUnreportedHistory } from "../discoveries/unreportedBreakdown";
import { mapDiscoveryReviewReason, mapDiscoveryStatus } from "../discoveries/mapReacquisition";

interface MemorySqlite {
  exec(sql: string): void;
  prepare(sql: string): { all(parameters: Record<string, unknown>): unknown[] };
  close(): void;
}

const sqliteModule = "node:sqlite";
const sqlite = await import(/* @vite-ignore */ sqliteModule).catch(() => null) as
  { DatabaseSync: new (path: string) => MemorySqlite } | null;

function fixture(seed = true) {
  const db = new sqlite!.DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(initial + facets + sourceOrder + history);
  if (seed) db.exec(`
    INSERT INTO profiles(id,name) VALUES(1,'A'),(2,'B'),(3,'empty');
    INSERT INTO discovery_categories(id,name) VALUES(1,'史跡'),(2,'レリック');
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<15)
    INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,raw_row_json)
      SELECT x,x,'synthetic',CASE WHEN x=8 THEN 2 WHEN x=13 THEN NULL ELSE 1 END,
        CASE WHEN x IN (5,12,13) THEN NULL ELSE x*100 END,'{}' FROM n;
    UPDATE discoveries SET is_active=0 WHERE id=9;
    INSERT INTO quests(id,gvdb_id,title,offer_method,raw_row_json) VALUES
      (1,1,'map A','地理学','{}'),(2,2,'map B','考古学','{}'),
      (3,3,'automatic','レガシー','{}'),(4,4,'mixed special','追究クエスト','{}'),
      (5,5,'mixed normal','冒険クエスト','{}');
    INSERT INTO quest_discoveries VALUES(1,11),(2,11),(3,10),(4,15),(5,15);
    INSERT INTO discovery_progress(profile_id,discovery_id,reported) VALUES
      (1,1,0),(1,2,0),(1,3,0),(1,4,0),(1,5,0),(1,6,1),(1,8,0),
      (1,9,0),(1,10,0),(1,11,0),(1,12,0),(1,13,0),(1,15,0),(2,1,0),(2,2,0);
    INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit) VALUES
      (1,1,'not_reported',0),(1,2,'confirmed',0),(1,3,'unknown',1),(1,4,'unknown',0),
      (1,6,'confirmed',0),(1,7,'confirmed',0),(1,8,'confirmed',0),(1,9,'confirmed',0),
      (1,10,'unknown',0),(1,11,'confirmed',0),(1,12,'not_reported',0),(1,13,'confirmed',0),
      (1,15,'not_reported',0),(2,1,'confirmed',0),(2,2,'unknown',1);
  `);
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const client: DatabaseClient = {
    async select<T>(sql: string, parameters: unknown[] = []): Promise<T> {
      calls.push({ sql, parameters });
      return db.prepare(sql).all(Object.fromEntries(parameters.map((value, i) => [String(i + 1), value]))) as T;
    },
    async execute() { throw new Error("read-only aggregation adapter"); },
  };
  const repo = new ProgressStatsRepository(async () => client);
  async function read(profileId = 1) {
    db.exec("PRAGMA query_only=ON;");
    try { return await repo.getForProfile(profileId); }
    finally { db.exec("PRAGMA query_only=OFF;"); }
  }
  function snapshot() {
    return JSON.stringify(["profiles", "discovery_progress", "discovery_reporting_history", "quest_progress"]
      .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all({})));
  }
  return { db, read, calls, snapshot, reader: new DiscoveryStateReader(async () => client) };
}

function partition(stats: ProgressStats, expected: [number, number, number, number]) {
  const { unreported, unreportedBreakdown: counts } = stats.discoveries;
  expect(counts).toBeDefined();
  expect([unreported, counts!.notReported, counts!.confirmed, counts!.unknown]).toEqual(expected);
  expect(unreported).toBe(counts!.notReported + counts!.confirmed + counts!.unknown);
  for (const category of stats.categories) {
    const breakdown=category.unreportedBreakdown;
    expect(breakdown).toBeDefined();
    expect(category.unreported).toBe(breakdown!.notReported+breakdown!.confirmed+breakdown!.unknown);
  }
}

const baselineMerit = { knownMerit: 4800, reportedCount: 8, knownExperienceCount: 7, unknownExperienceCount: 1 };

describe.skipIf(sqlite === null)("current-unreported history groups with actual repository SQL", () => {
  it("matches list filters to C7/C8 totals for each profile and preserves all saved progress", async () => {
    const f = fixture();
    try {
      // 一つの地図に複数発見物、報告対象外、両方の条件を合成する。
      f.db.exec(`INSERT INTO quest_discoveries VALUES(1,12),(2,8);
        INSERT INTO quest_progress(profile_id,quest_id,memo) VALUES(1,1,'synthetic quest memo');
        UPDATE discovery_progress SET memo='synthetic discovery memo',card_owned=1,report_hold=1 WHERE profile_id=1 AND discovery_id=1;`);
      const before = f.snapshot();
      for (const profileId of [1,2,3]) {
        f.db.exec("PRAGMA query_only=ON");
        const states = await f.reader.list(profileId);
        const rows = states.filter(s=>s.active).map(s=>({
          id:s.id, canReport:s.categoryName!=="レリック", mapRelated:!!s.mapRelated, mapNeedsReview:!!s.mapNeedsReview,
          progress:s.discovered?{profileId,discoveryId:s.id,reported:!!s.reported,cardOwned:false,memo:null,updatedAt:"p"}:null,
          effectiveReported:!!s.discovered && !!(s.reported || s.automaticReporting),
          firstReportStatus:s.firstReportStatus, historyPresent:s.historyUpdatedAt!==null,
        }));
        const stats = await f.read(profileId);
        const classified = rows.map(r=>({id:r.id,status:currentUnreportedHistory(r)}));
        expect(classified.filter(r=>r.status!==null)).toHaveLength(stats.discoveries.unreported);
        for (const [status,key] of [["not_reported","notReported"],["confirmed","confirmed"],["unknown","unknown"]] as const) {
          expect(classified.filter(r=>r.status===status)).toHaveLength(stats.discoveries.unreportedBreakdown![key]);
        }
        if (profileId === 1) {
          expect(classified.filter(r=>r.status==="unknown").map(r=>r.id)).toEqual([3,4,5]);
          expect(rows.find(r=>r.id===3)?.mapRelated).toBe(false);
          const multiple = rows.find(r=>r.id===12)!;
          expect(mapDiscoveryStatus(multiple)).toBe("review");
          expect(mapDiscoveryReviewReason(multiple)).toContain("一つの地図に複数の発見物");
          const relic = rows.find(r=>r.id===8)!;
          expect(mapDiscoveryStatus(relic)).toBe("review");
          expect(mapDiscoveryReviewReason(relic)).toContain("報告対象外");
          expect(stats.adventureMerit).toEqual(baselineMerit);
        }
      }
      expect(f.snapshot()).toBe(before);
    } finally { f.db.close(); }
  });
  it.each([
    [1, [1, 1, 0, 0]], [2, [1, 0, 1, 0]], [3, [1, 0, 0, 1]],
    [4, [1, 0, 0, 1]], [5, [1, 0, 0, 1]], [6, [0, 0, 0, 0]],
    [7, [0, 0, 0, 0]], [8, [0, 0, 0, 0]], [9, [0, 0, 0, 0]],
    [10, [0, 0, 0, 0]], [11, [1, 0, 1, 0]], [12, [1, 1, 0, 0]],
    [13, [1, 0, 1, 0]], [15, [1, 1, 0, 0]],
  ] as Array<[number, [number, number, number, number]]>)(
    "classifies discovery %i independently of other current progress", async (id, expected) => {
      const f = fixture();
      try {
        f.db.exec(`DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id<>${id};`);
        const result = await f.read();
        partition(result, expected);
        expect(result.categories.find((category)=>category.categoryId===1)?.unreportedBreakdown).toEqual(id===13
          ? {notReported:0,confirmed:0,unknown:0}
          : {notReported:expected[1],confirmed:expected[2],unknown:expected[3]});
        expect(result.adventureMerit).toEqual(id === 10 ? baselineMerit : {
          knownMerit: 3800, reportedCount: 7, knownExperienceCount: 6, unknownExperienceCount: 1,
        });
      } finally { f.db.close(); }
    },
  );

  it("partitions the unchanged discovery population, keeps merit exceptions separate, and performs no writes", async () => {
    const f = fixture();
    try {
      const before = f.snapshot();
      const stats = await f.read();
      partition(stats, [9, 3, 3, 3]);
      expect(stats.discoveries).toMatchObject({ total: 14, discovered: 12, reported: 2 });
      expect(stats.adventureMerit).toEqual(baselineMerit);
      // unknown+legacy remains unknown; raw reported=0 can still be automatically reported.
      const raw = f.db.prepare("SELECT discovery_id,reported FROM discovery_progress WHERE profile_id=1 AND discovery_id IN (3,10) ORDER BY discovery_id").all({});
      expect(raw).toEqual([{ discovery_id: 3, reported: 0 }, { discovery_id: 10, reported: 0 }]);
      expect(f.calls).toHaveLength(3);
      expect(f.calls.every((call) => call.parameters[0] === 1)).toBe(true);
      expect(f.snapshot()).toBe(before);
    } finally { f.db.close(); }
  });

  it("maps ordered category partitions from the same SQL and preserves the existing NULL-category difference", async () => {
    const f=fixture();
    try {
      f.db.exec(`INSERT INTO discovery_categories(id,name,sort_order) VALUES(3,'海域',10),(4,'生物',30),(5,'空分類',5);
        UPDATE discovery_categories SET sort_order=20 WHERE id=1;
        UPDATE discovery_categories SET sort_order=40 WHERE id=2;
        UPDATE discoveries SET category_id=3 WHERE id IN (2,3,5,10,11);
        UPDATE discoveries SET category_id=4 WHERE id IN (4,12,15);`);
      const snapshot=f.snapshot();
      const result=await f.read();
      partition(result,[9,3,3,3]);
      expect(result.categories.map((c)=>c.categoryId)).toEqual([3,1,4,2]);
      expect(result.categories.map((c)=>[c.unreported,c.unreportedBreakdown])).toEqual([
        [4,{notReported:0,confirmed:2,unknown:2}],
        [1,{notReported:1,confirmed:0,unknown:0}],
        [3,{notReported:2,confirmed:0,unknown:1}],
        [0,{notReported:0,confirmed:0,unknown:0}],
      ]);
      expect(result.categories.find((c)=>c.categoryId===2)).toMatchObject({canReport:false,hasCard:false});
      // NULL category 13 remains in the global total, without adding a new category card.
      expect(result.categories.reduce((sum,c)=>sum+c.unreported,0)).toBe(8);
      expect(result.categories.reduce((sum,c)=>sum+c.unreportedBreakdown!.confirmed,0)).toBe(2);
      expect(result.adventureMerit).toEqual(baselineMerit);
      expect(f.calls).toHaveLength(3);
      expect(f.snapshot()).toBe(snapshot);
      const other=await f.read(2);
      partition(other,[2,0,1,1]);
      expect(other.categories.slice(0,3).map((c)=>c.unreportedBreakdown)).toEqual([
        {notReported:0,confirmed:0,unknown:1},{notReported:0,confirmed:1,unknown:0},{notReported:0,confirmed:0,unknown:0},
      ]);
      const empty=await f.read(3);
      partition(empty,[0,0,0,0]);
      expect(empty.categories.every((c)=>c.unreported===0)).toBe(true);
    } finally {f.db.close();}
  });

  it("keeps category partitions aligned with first report, rediscovery and explicit history correction", async () => {
    const f=fixture();
    const counts=(stats:ProgressStats)=>stats.categories.find((c)=>c.categoryId===1)!.unreportedBreakdown;
    try {
      const initial=await f.read();
      expect(counts(initial)).toEqual({notReported:3,confirmed:2,unknown:3});
      f.db.exec(`UPDATE discovery_progress SET reported=1 WHERE profile_id=1 AND discovery_id=1;
        UPDATE discovery_reporting_history SET first_report_status='confirmed' WHERE profile_id=1 AND discovery_id=1;`);
      const first=await f.read();
      partition(first,[8,2,3,3]);
      expect(counts(first)).toEqual({notReported:2,confirmed:2,unknown:3});
      f.db.exec("UPDATE discovery_progress SET reported=0 WHERE profile_id=1 AND discovery_id=1;");
      const rediscovered=await f.read();
      partition(rediscovered,[9,2,4,3]);
      expect(counts(rediscovered)).toEqual({notReported:2,confirmed:3,unknown:3});
      expect(rediscovered.adventureMerit).toEqual(first.adventureMerit);
      f.db.exec("UPDATE discovery_reporting_history SET first_report_status='not_reported' WHERE profile_id=1 AND discovery_id=4;");
      const corrected=await f.read();
      partition(corrected,[9,3,4,2]);
      expect(counts(corrected)).toEqual({notReported:3,confirmed:3,unknown:2});
      expect(corrected.adventureMerit).toEqual(first.adventureMerit);
      partition(await f.read(2),[2,0,1,1]);
    } finally {f.db.close();}
  });

  it("changes only the existing category grouping when a synthetic NULL-category record is assigned", async () => {
    const f=fixture();
    try {
      const before=await f.read();
      partition(before,[9,3,3,3]);
      f.db.exec("UPDATE discoveries SET category_id=1 WHERE id=13;");
      const after=await f.read();
      partition(after,[9,3,3,3]);
      expect(after.categories.find((c)=>c.categoryId===1)).toMatchObject({unreported:9,unreportedBreakdown:{notReported:3,confirmed:3,unknown:3}});
      expect(after.categories.reduce((sum,c)=>sum+c.unreported,0)).toBe(after.discoveries.unreported);
      expect(after.adventureMerit).toEqual(before.adventureMerit);
    } finally {f.db.close();}
  });

  it("includes ordinary and uncategorized discoveries, and counts a discovery linked to two maps only once", async () => {
    const f = fixture();
    try {
      const before = await f.read();
      // Ordinary discovery 12 has unknown experience, but confirmed not_reported history.
      f.db.exec("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=12;");
      const withoutOrdinary = await f.read();
      partition(withoutOrdinary, [8, 2, 3, 3]);
      expect(withoutOrdinary.adventureMerit).toEqual(before.adventureMerit);
      // Removing just one of the two map relationships does not alter discovery counts.
      f.db.exec("DELETE FROM quest_discoveries WHERE quest_id=2 AND discovery_id=11;");
      const oneMap = await f.read();
      partition(oneMap, [8, 2, 3, 3]);
      expect(oneMap.adventureMerit).toEqual(before.adventureMerit);
      f.db.exec("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=13;");
      const withoutUncategorized = await f.read();
      partition(withoutUncategorized, [7, 2, 2, 3]);
      expect(withoutUncategorized.adventureMerit).toEqual(before.adventureMerit);
    } finally { f.db.close(); }
  });

  it("tracks first report, rediscovery, re-report, history corrections and profile switching", async () => {
    const f = fixture();
    try {
      partition(await f.read(), [9, 3, 3, 3]);
      // Fixture state transitions only: production update APIs are unchanged.
      f.db.exec(`UPDATE discovery_progress SET reported=1 WHERE profile_id=1 AND discovery_id=1;
        UPDATE discovery_reporting_history SET first_report_status='confirmed' WHERE profile_id=1 AND discovery_id=1;`);
      const firstReport = await f.read();
      partition(firstReport, [8, 2, 3, 3]);
      expect(firstReport.adventureMerit).toEqual({ ...baselineMerit, knownMerit: 4900, reportedCount: 9, knownExperienceCount: 8 });
      f.db.exec("UPDATE discovery_progress SET reported=0 WHERE profile_id=1 AND discovery_id=1;");
      const rediscovered = await f.read();
      partition(rediscovered, [9, 2, 4, 3]);
      expect(rediscovered.adventureMerit).toEqual(firstReport.adventureMerit);
      expect(f.db.prepare("SELECT first_report_status FROM discovery_reporting_history WHERE profile_id=1 AND discovery_id=1").all({}))
        .toEqual([{ first_report_status: "confirmed" }]);
      f.db.exec("UPDATE discovery_progress SET reported=1 WHERE profile_id=1 AND discovery_id=1;");
      const reportedAgain = await f.read();
      partition(reportedAgain, [8, 2, 3, 3]);
      expect(reportedAgain.adventureMerit).toEqual(firstReport.adventureMerit);
      f.db.exec("UPDATE discovery_reporting_history SET first_report_status='not_reported' WHERE profile_id=1 AND discovery_id=4;");
      const corrected = await f.read();
      partition(corrected, [8, 3, 3, 2]);
      expect(corrected.adventureMerit).toEqual(firstReport.adventureMerit);
      f.db.exec("UPDATE discovery_reporting_history SET first_report_status='confirmed' WHERE profile_id=1 AND discovery_id=4;");
      const confirmed = await f.read();
      partition(confirmed, [8, 2, 4, 2]);
      expect(confirmed.adventureMerit).toEqual({ ...firstReport.adventureMerit, knownMerit: 5300, reportedCount: 10, knownExperienceCount: 9 });
      partition(await f.read(2), [2, 0, 1, 1]);
      partition(await f.read(3), [0, 0, 0, 0]);
      partition(await f.read(1), [8, 2, 4, 2]);
    } finally { f.db.close(); }
  });

  it("retains confirmed history and merit after deleting and re-registering current map progress", async () => {
    const f = fixture();
    try {
      const before = await f.read();
      f.db.exec("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=11;");
      const removed = await f.read();
      partition(removed, [8, 3, 2, 3]);
      expect(removed.adventureMerit).toEqual(before.adventureMerit);
      f.db.exec("INSERT INTO discovery_progress(profile_id,discovery_id,reported) VALUES(1,11,0);");
      const registered = await f.read();
      partition(registered, [9, 3, 3, 3]);
      expect(registered.adventureMerit).toEqual(before.adventureMerit);
    } finally { f.db.close(); }
  });

  it("returns a zero partition and zero merit with no masters or progress", async () => {
    const f = fixture(false);
    try {
      const result = await f.read();
      partition(result, [0, 0, 0, 0]);
      expect(result.adventureMerit).toEqual({ knownMerit: 0, reportedCount: 0, knownExperienceCount: 0, unknownExperienceCount: 0 });
    } finally { f.db.close(); }
  });
});
