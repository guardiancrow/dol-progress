import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createMemoryDatabase,validateSchema,readData,businessFingerprint,schemaFingerprint,sqlMerit,inspectRepair,applyRepair} from './tests/map-history-memory-support.mjs';

function fixture(reported=2,relics=1) {
  const db=createMemoryDatabase();
  const names=['initial_schema','quest_facets','master_source_order','map_report_hold'];
  const files=['001_initial.sql','002_quest_facets.sql','003_master_source_order.sql','004_map_report_hold.sql'];
  db.exec("CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY,description TEXT,success INTEGER,checksum BLOB,execution_time INTEGER DEFAULT 1,installed_on TEXT DEFAULT CURRENT_TIMESTAMP)");
  files.forEach((file,i)=>{const sql=readFileSync('src-tauri/migrations/'+file,'utf8');db.exec(sql);db.prepare('INSERT INTO _sqlx_migrations(version,description,success,checksum) VALUES(?,?,1,?)').run(i+1,names[i],createHash('sha384').update(sql).digest());});
  db.exec("BEGIN; INSERT INTO profiles(id,name,memo) VALUES(1,'synthetic','synthetic profile memo'); INSERT INTO discovery_categories(id,name) VALUES(1,'史跡'),(2,'レリック')");
  const insertD=db.prepare("INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,raw_row_json) VALUES(?,?,'synthetic',?,?,'{}')");
  const insertP=db.prepare("INSERT INTO discovery_progress(profile_id,discovery_id,reported,card_owned,memo,updated_at) VALUES(1,?,?,0,'synthetic progress memo','original-time')");
  const insertH=db.prepare("INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit,updated_at) VALUES(1,?,'unknown',1,'migration-time')");
  for(let id=1;id<=reported+1+relics;id++) {insertD.run(id,id+1000,id>reported+1?2:1,id===1?null:100);insertP.run(id,id===reported+1?0:1);if(id<=reported)insertH.run(id);}
  db.exec('COMMIT');
  const source=readData(db,3);source.progress=source.progress.map(({report_hold,...r})=>r);
  const reference=readData(db);
  return {db,source,reference,close:()=>db.close()};
}
const allState=db=>JSON.stringify({business:businessFingerprint(db),data:readData(db)});
function checks(referenceBusiness,referenceSchema) {
  return (_phase,db)=>{validateSchema(db,4);assert.equal(businessFingerprint(db),referenceBusiness);assert.equal(schemaFingerprint(db),referenceSchema);};
}

test('synthetic batch preserves rows, timestamps and SQL ID sets',()=>{
  const syntheticCount=64, syntheticRelics=4;
  const f=fixture(syntheticCount,syntheticRelics);const {db,source,reference}=f;
  try {
    const business=businessFingerprint(db),schema=schemaFingerprint(db),before=sqlMerit(db,1);
    const result=applyRepair(db,source,reference,{validate:checks(business,schema)});
    assert.deepEqual(result,{updates:syntheticCount,inserts:1,alreadyApplied:false,preCommitValidated:true});
    assert.equal(inspectRepair(source,reference,readData(db)).state,'already-applied');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM discovery_reporting_history WHERE first_report_status='confirmed' AND legacy_merit_credit=0 AND updated_at='migration-time'").get().n,syntheticCount);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM discovery_reporting_history WHERE first_report_status='not_reported' AND legacy_merit_credit=0").get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_reporting_history h JOIN discoveries d ON d.id=h.discovery_id WHERE d.category_id=2').get().n,0);
    assert.equal(businessFingerprint(db),business);assert.deepEqual(sqlMerit(db,1),before);
    const after=allState(db);assert.deepEqual(applyRepair(db,source,reference),{updates:0,inserts:0,alreadyApplied:true});assert.equal(allState(db),after);
  } finally {f.close();}
});
test('reference confirmed and not_reported rows remain unchanged',()=>{
  const f=fixture();try {
    f.db.exec("UPDATE discovery_reporting_history SET first_report_status='confirmed',legacy_merit_credit=0 WHERE discovery_id=1; INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,updated_at) VALUES(1,3,'not_reported','known-time')");
    const reference=readData(f.db);const result=applyRepair(f.db,f.source,reference);
    assert.equal(result.updates,1);assert.equal(result.inserts,0);
    assert.equal(f.db.prepare('SELECT updated_at FROM discovery_reporting_history WHERE discovery_id=3').get().updated_at,'known-time');
  } finally {f.close();}
});
test('conflicting history or timestamp change is rejected without overwriting it',()=>{
  for(const sql of ["UPDATE discovery_reporting_history SET first_report_status='not_reported',legacy_merit_credit=0 WHERE discovery_id=1","UPDATE discovery_reporting_history SET first_report_status='confirmed',legacy_merit_credit=0 WHERE discovery_id=1","UPDATE discovery_reporting_history SET updated_at='changed' WHERE discovery_id=1"]) {
    const f=fixture();try{f.db.exec(sql);const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference));assert.equal(allState(f.db),before);}finally{f.close();}
  }
});
test('primary-key mismatch is rejected before writes',()=>{
  const f=fixture();try {f.db.exec('DELETE FROM discovery_progress WHERE discovery_id=1');const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference));assert.equal(allState(f.db),before);}finally{f.close();}
});
test('schema/migration mismatch and CHECK violation are rejected',()=>{
  const f=fixture();try {
    assert.throws(()=>f.db.exec("UPDATE discovery_reporting_history SET first_report_status='confirmed' WHERE discovery_id=1"),/CHECK constraint/);
    f.db.exec('DELETE FROM _sqlx_migrations WHERE version=4');
    assert.throws(()=>validateSchema(f.db,4),/migration version/);
    const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference),/migration version/);assert.equal(allState(f.db),before);
  } finally {f.close();}
});
test('fault after first UPDATE rolls back every change',()=>{
  const f=fixture();try {const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference,{failAt:0}),/Synthetic transaction fault/);assert.equal(allState(f.db),before);}finally{f.close();}
});
test('failure after all writes but before COMMIT rolls back UPDATEs and INSERT',()=>{
  const f=fixture();try {const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference,{validate:phase=>{if(phase==='after')throw Error('Synthetic audit failure');}}),/Synthetic audit failure/);assert.equal(allState(f.db),before);}finally{f.close();}
});
test('changed current progress is refused and requires Owner review',()=>{
  const f=fixture();try {f.db.exec("UPDATE discovery_progress SET memo='changed memo' WHERE discovery_id=1");const before=allState(f.db);assert.throws(()=>applyRepair(f.db,f.source,f.reference));assert.equal(allState(f.db),before);}finally{f.close();}
});
