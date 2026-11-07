import { firstReportDisplay } from "../discoveries/firstReport";
import { DiscoveryStateReader, currentState } from "../discoveries/stateReader";
import { describe, expect, it } from "vitest";
import schema from "../../src-tauri/migrations/001_initial.sql?raw";
import mapReportHold from "../../src-tauri/migrations/004_map_report_hold.sql?raw";
import sourceOrder from "../../src-tauri/migrations/003_master_source_order.sql?raw";
import type { DatabaseClient } from "../db/client";
import { DiscoveryRepository } from "./discoveryRepository";
import { DiscoveryProgressRepository } from "./discoveryProgressRepository";
import { ProgressStatsRepository } from "./progressStatsRepository";

interface MemorySqlite {
  exec(sql: string): void;
  prepare(sql: string): { all(parameters: Record<string, unknown>): unknown[] };
  close(): void;
}

// Native SQLite is optional on older Node versions; Rust tests cover the shared SQL too.
const sqliteModule = "node:sqlite";
const sqlite = await import(/* @vite-ignore */ sqliteModule).catch(() => null) as
  { DatabaseSync: new (path: string) => MemorySqlite } | null;

describe.skipIf(sqlite === null)("automatic reporting with actual repository SQL", () => {
  it("reads the C3R summary after quest writes at full synthetic master size", async () => {
    const db = new sqlite!.DatabaseSync(":memory:");
    try {
      db.exec(schema + sourceOrder + mapReportHold);
      db.exec(`INSERT INTO profiles(id,name) VALUES(1,'synthetic');
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<6784)
        INSERT INTO quests(id,gvdb_id,title,offer_method,raw_row_json) SELECT x,x,'synthetic','地理学','{}' FROM n;
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4032)
        INSERT INTO discoveries(id,gvdb_id,name,raw_row_json) SELECT x,x,'synthetic','{}' FROM n;
        INSERT INTO quest_discoveries SELECT id,id FROM discoveries;
        INSERT INTO quest_progress(profile_id,quest_id) VALUES(1,1);
        INSERT INTO discovery_progress(profile_id,discovery_id) VALUES(1,1);
        INSERT INTO discovery_reporting_history(profile_id,discovery_id) SELECT 1,id FROM discoveries;`);
      let reads = 0;
      const client: DatabaseClient = {
        async select<T>(sql: string, parameters: unknown[] = []): Promise<T> {
          reads++;
          return db.prepare(sql).all(Object.fromEntries(parameters.map((value,i)=>[String(i+1),value]))) as T;
        },
        async execute() { throw new Error("read-only test adapter"); },
      };
      const reader = new DiscoveryStateReader(async()=>client);
      const start = performance.now();
      const summaries=await reader.list(1);
      expect(summaries.find(s=>s.id===1)).toMatchObject({discovered:1,reported:0,mapRelated:1});
      expect(summaries.map(s=>firstReportDisplay({
        canReport:s.categoryName!=="レリック",firstReportStatus:s.firstReportStatus,
        effectiveReported:!!s.discovered&&!!(s.reported||s.automaticReporting),
        automaticReporting:!!s.automaticReporting,
      })).filter(s=>s.text==="不明")).toHaveLength(4032);
      db.exec("DELETE FROM quest_progress WHERE profile_id=1 AND quest_id=1");
      expect((await reader.list(1)).find(s=>s.id===1)).toMatchObject({discovered:1,reported:0});
      const stats = await new ProgressStatsRepository(async()=>client).getForProfile(1);
      expect(stats.discoveries).toMatchObject({total:4032,unreported:1,unreportedBreakdown:{notReported:0,confirmed:0,unknown:1}});
      expect(reads).toBe(5);
      expect(performance.now()-start).toBeLessThan(5000);
    } finally { db.close(); }
  }, 10000);

  it("derives legacy state, counts each discovery once, isolates profiles and preserves raw progress", async () => {
    const db = new sqlite!.DatabaseSync(":memory:");
    try {
      db.exec(schema + sourceOrder);
      db.exec(`
        INSERT INTO profiles (id, name) VALUES (1, 'A'), (2, 'B');
        INSERT INTO discovery_categories (id, name) VALUES (1, '史跡'), (2, 'レリック');
        INSERT INTO quests (id, gvdb_id, title, offer_method, raw_row_json) VALUES
          (1, 1, '追究', '追究クエスト', '{}'), (2, 2, 'Legacy', 'レガシー', '{}'),
          (3, 3, 'Treasure', 'トレジャーハント', '{}'), (4, 4, 'Normal', NULL, '{}'),
          (5, 5, 'Inactive', 'レガシー', '{}'), (6, 6, 'Typo', '追及クエスト', '{}');
        UPDATE quests SET is_active = 0 WHERE id = 5;
        INSERT INTO discoveries (id, gvdb_id, category_id, name, experience, raw_row_json) VALUES
          (1, 1, 1, 'Old pursuit', 100, '{}'), (2, 2, 1, 'Legacy', NULL, '{}'),
          (3, 3, 1, 'Treasure', 200, '{}'), (4, 4, 2, 'Relic', 900, '{}'),
          (5, 5, 1, 'Mixed', 300, '{}'), (6, 6, 1, 'Multiple special', 400, '{}'),
          (7, 7, 1, 'Inactive discovery', 50, '{}'), (8, 8, 1, 'Typo', 800, '{}'),
          (9, 9, 1, 'Not discovered', 1000, '{}');
        UPDATE discoveries SET is_active = 0 WHERE id = 7;
        INSERT INTO quest_discoveries VALUES (1, 1), (5, 1), (2, 2), (3, 3), (3, 4),
          (1, 5), (4, 5), (1, 6), (2, 6), (2, 7), (6, 8), (2, 9);
        INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES
          (1, 1, 0, 0, 'keep'), (1, 2, 0, 1, NULL), (1, 3, 0, 1, NULL),
          (1, 4, 1, 1, NULL), (1, 5, 0, 1, NULL), (1, 6, 1, 1, NULL),
          (1, 7, 0, 0, NULL), (1, 8, 0, 0, NULL), (2, 5, 1, 0, NULL);
      `);
      db.exec(mapReportHold);
      const client: DatabaseClient = {
        async select<T>(sql: string, parameters: unknown[] = []): Promise<T> {
          return db.prepare(sql).all(Object.fromEntries(parameters.map((value, i) => [String(i + 1), value]))) as T;
        },
        async execute() { throw new Error("read-only test adapter"); },
      };
      const provider = async () => client;
      const reader = new DiscoveryStateReader(provider);
      const summary = await reader.list(1);
      expect(summary).toHaveLength(9);
      expect(summary.find(s=>s.id===1)).toMatchObject({discovered:1,reported:0,automaticReporting:1,firstReportStatus:"unknown",legacyMeritCredit:1});
      expect(summary.find(s=>s.id===9)).toMatchObject({discovered:0,legacyMeritCredit:0});
      expect((await reader.list(2)).find(s=>s.id===5)).toMatchObject({reported:1,legacyMeritCredit:1});
      const master = new DiscoveryRepository(provider);
      const progress = new DiscoveryProgressRepository(provider);
      const stats = new ProgressStatsRepository(provider);
      expect((await master.listWithRelations()).filter((item) => item.automaticReporting).map((item) => item.discovery.id))
        .toEqual([1, 2, 3, 7, 9]);
      const a = await stats.getForProfile(1);
      expect(a.discoveries).toMatchObject({ total: 8, discovered: 7, reported: 4, unreported: 2, cardOwned: 4 });
      expect(a.adventureMerit).toEqual({ knownMerit: 750, reportedCount: 5, knownExperienceCount: 4, unknownExperienceCount: 1 });
      expect((await stats.getForProfile(2)).adventureMerit).toMatchObject({ knownMerit: 300, reportedCount: 1 });
      expect(await progress.listUnreportedIds(1)).toEqual([5, 8]);
      expect(await progress.listCardOwnedIds(1)).toEqual([2, 3, 5, 6]);
      expect(await progress.get(1, 1)).toMatchObject({ reported: false, cardOwned: false, memo: "keep" });
      db.exec("UPDATE quests SET offer_method = NULL WHERE id = 1");
      expect((await master.listWithRelations()).find((item) => item.discovery.id === 1)?.automaticReporting).toBe(false);
      expect((await stats.getForProfile(1)).adventureMerit.knownMerit).toBe(750);
      expect(await progress.get(1, 1)).toMatchObject({ reported: false, cardOwned: false, memo: "keep" });
      db.exec(`INSERT INTO quests(id,gvdb_id,title,offer_method,raw_row_json) VALUES (10,10,'map','地理学','{}'),(11,11,'other map','収奪・陸戦地図','{}'),(12,12,'inactive map','生物学','{}');
        UPDATE quests SET is_active=0 WHERE id=12;
        INSERT INTO quest_discoveries VALUES (10,5),(11,8),(12,6);`);
      for(const hold of [0,1]) {
        db.exec(`UPDATE discovery_progress SET report_hold=${hold} WHERE profile_id=1 AND discovery_id=5`);
        const rows=await reader.list(1);
        expect(rows.find(s=>s.id===5)).toMatchObject({mapRelated:1,mapNeedsReview:0,reportHold:hold});
        expect(currentState(rows.find(s=>s.id===5)!)).toBe('unreported');
        expect(rows.find(s=>s.id===8)?.mapRelated).toBe(0);
        expect(rows.find(s=>s.id===6)?.mapRelated).toBe(0);
      }
      db.exec("INSERT INTO quest_discoveries VALUES (10,6)");
      expect((await reader.list(1)).find(s=>s.id===5)?.mapNeedsReview).toBe(1);
    } finally { db.close(); }
  });
});

describe.skipIf(sqlite === null)("first-report partition",()=>{
  it("partitions exactly the existing current-unreported population without changing merit",async()=>{
    const db=new sqlite!.DatabaseSync(":memory:");
    try {
      db.exec(schema+sourceOrder+mapReportHold);
      db.exec(`INSERT INTO profiles(id,name) VALUES(1,'A'),(2,'B');
        INSERT INTO discovery_categories(id,name) VALUES(1,'史跡'),(2,'レリック');
        WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9)
        INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,raw_row_json)
          SELECT x,x,'synthetic',CASE WHEN x=7 THEN 2 ELSE 1 END,100,'{}' FROM n;
        UPDATE discoveries SET is_active=0 WHERE id=8;
        INSERT INTO quests(id,gvdb_id,title,offer_method,raw_row_json) VALUES(1,1,'special','レガシー','{}');
        INSERT INTO quest_discoveries VALUES(1,6);
        INSERT INTO discovery_progress(profile_id,discovery_id,reported) VALUES
          (1,1,0),(1,2,0),(1,3,0),(1,4,0),(1,5,1),(1,6,0),(1,7,0),(1,8,0),(2,1,0);
        INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit) VALUES
          (1,1,'confirmed',0),(1,2,'not_reported',0),(1,3,'unknown',1),
          (1,5,'confirmed',0),(1,8,'confirmed',0),(1,9,'confirmed',0),(2,1,'not_reported',0);`);
      let reads=0;
      const client:DatabaseClient={
        async select<T>(sql:string,parameters:unknown[]=[]):Promise<T>{reads++;return db.prepare(sql).all(Object.fromEntries(parameters.map((v,i)=>[String(i+1),v]))) as T;},
        async execute(){throw new Error("read-only adapter");},
      };
      const repo=new ProgressStatsRepository(async()=>client);
      const a=await repo.getForProfile(1);
      expect(reads).toBe(3);
      expect(a.discoveries).toMatchObject({total:8,discovered:7,unreported:4,reported:2,unreportedBreakdown:{notReported:1,confirmed:1,unknown:2}});
      expect((await repo.getForProfile(2)).discoveries).toMatchObject({unreported:1,unreportedBreakdown:{notReported:1,confirmed:0,unknown:0}});
      db.exec("DELETE FROM discovery_progress WHERE profile_id=1 AND discovery_id=1");
      const after=await repo.getForProfile(1);
      expect(after.discoveries).toMatchObject({unreported:3,unreportedBreakdown:{notReported:1,confirmed:0,unknown:2}});
      expect(after.adventureMerit).toEqual(a.adventureMerit);
      expect((await new DiscoveryStateReader(async()=>client).list(1)).find(s=>s.id===1)).toMatchObject({discovered:0,firstReportStatus:"confirmed"});
      db.exec("UPDATE discovery_reporting_history SET first_report_status='not_reported',legacy_merit_credit=0 WHERE profile_id=1 AND discovery_id=3");
      const corrected=await repo.getForProfile(1);
      expect(corrected.discoveries).toMatchObject({unreported:3,unreportedBreakdown:{notReported:2,confirmed:0,unknown:1}});
      expect(corrected.adventureMerit.knownMerit).toBe(after.adventureMerit.knownMerit-100);
      expect(corrected.adventureMerit.reportedCount).toBe(after.adventureMerit.reportedCount-1);
      db.exec("UPDATE discovery_reporting_history SET first_report_status='confirmed' WHERE profile_id=1 AND discovery_id=3");
      const confirmed=await repo.getForProfile(1);
      expect(confirmed.discoveries).toMatchObject({unreported:3,unreportedBreakdown:{notReported:1,confirmed:1,unknown:1}});
      expect(confirmed.adventureMerit).toEqual(after.adventureMerit);
    }finally{db.close();}
  });
});
