import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {planHistory,merit,sameMerit} from './map-history-h1-plan.mjs';

const clone=value=>structuredClone(value);
function fixture() {
  const source={version:3,profiles:[{id:1,name:'synthetic'}],discoveries:[1,2,3].map(id=>({id,gvdb_id:100+id,relic:id===3?1:0,experience:100,is_active:1})),
    progress:[1,2,3].map(id=>({profile_id:1,discovery_id:id,reported:id===2?0:1,card_owned:id===1?0:1,memo:'synthetic memo',updated_at:'original'})),histories:[],automaticIds:[]};
  const target={...clone(source),version:4,progress:source.progress.map(r=>({...r,report_hold:0})),histories:[{profile_id:1,discovery_id:1,first_report_status:'unknown',legacy_merit_credit:1,updated_at:'migration'}]};
  return {source,target};
}
function memory(target) {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync('src-tauri/migrations/001_initial.sql','utf8')+readFileSync('src-tauri/migrations/004_map_report_hold.sql','utf8'));
  db.exec("INSERT INTO discovery_categories(id,name) VALUES(1,'史跡'),(2,'レリック')");
  const insert=db.prepare('INSERT INTO discovery_progress(profile_id,discovery_id,reported,card_owned,memo,updated_at,report_hold) VALUES(?,?,?,?,?,?,?)');
  for(const p of target.profiles) db.prepare('INSERT INTO profiles(id,name) VALUES(?,?)').run(p.id,p.name);
  for(const d of target.discoveries) db.prepare("INSERT INTO discoveries(id,gvdb_id,name,category_id,experience,raw_row_json) VALUES(?,?,'synthetic',?,?,'{}')").run(d.id,d.gvdb_id,d.relic?2:1,d.experience);
  for(const p of target.progress) insert.run(p.profile_id,p.discovery_id,p.reported,p.card_owned,p.memo,p.updated_at,p.report_hold);
  for(const h of target.histories) db.prepare('INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit,updated_at) VALUES(?,?,?,?,?)').run(h.profile_id,h.discovery_id,h.first_report_status,h.legacy_merit_credit,h.updated_at);
  return db;
}
function readTarget(db,target) {
  return {...target,progress:db.prepare('SELECT * FROM discovery_progress ORDER BY profile_id,discovery_id').all().map(r=>({...r})),
    histories:db.prepare('SELECT * FROM discovery_reporting_history ORDER BY profile_id,discovery_id').all().map(r=>({...r}))};
}
function applySynthetic(db,plan,failAt=-1) {
  // This writer exists only in this test and explicitly rejects file-backed DBs.
  assert.ok(db.prepare('PRAGMA database_list').all().every(r=>r.file===''));
  assert.equal(plan.blocked,false);
  db.exec('BEGIN IMMEDIATE');
  try {
    plan.actions.forEach((a,index)=>{
      const actual=db.prepare('SELECT * FROM discovery_reporting_history WHERE profile_id=? AND discovery_id=?').get(a.profile_id,a.discovery_id);
      assert.equal(JSON.stringify(actual??null),JSON.stringify(a.expected));
      if(a.kind==='update') db.prepare('UPDATE discovery_reporting_history SET first_report_status=?,legacy_merit_credit=? WHERE profile_id=? AND discovery_id=?').run(a.first_report_status,a.legacy_merit_credit,a.profile_id,a.discovery_id);
      else db.prepare('INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit) VALUES(?,?,?,?)').run(a.profile_id,a.discovery_id,a.first_report_status,a.legacy_merit_credit);
      if(index===failAt) throw Error('Synthetic fault');
    });
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
}

test('old 1 confirms, old 0 inserts not_reported, relic excluded, IDs and all progress columns preserved',()=>{
  const {source,target}=fixture(); const plan=planHistory(source,target); const db=memory(target);
  try {
    assert.equal(plan.blocked,false); assert.equal(plan.counts.confirmedUpdates,1); assert.equal(plan.counts.notReportedInserts,1); assert.equal(plan.counts.excludedRelics,1);
    applySynthetic(db,plan);
    const after=readTarget(db,target);
    assert.deepEqual(after.progress,target.progress);
    assert.equal(after.histories[0].first_report_status,'confirmed'); assert.equal(after.histories[0].legacy_merit_credit,0);
    assert.equal(after.histories[0].updated_at,'migration'); assert.equal(after.histories[1].first_report_status,'not_reported');
    assert.ok(sameMerit(merit(target),merit(after)));
  } finally {db.close();}
});
test('confirmed history remains untouched including its timestamp',()=>{
  const {source,target}=fixture();target.histories[0]={...target.histories[0],first_report_status:'confirmed',legacy_merit_credit:0};
  const plan=planHistory(source,target);assert.equal(plan.blocked,false);assert.equal(plan.counts.unchanged,1);assert.ok(!plan.actions.some(a=>a.discovery_id===1));
});
test('later confirmation is not downgraded from an older zero flag',()=>{
  const {source,target}=fixture();target.histories.push({profile_id:1,discovery_id:2,first_report_status:'confirmed',legacy_merit_credit:0,updated_at:'later'});
  const plan=planHistory(source,target);assert.equal(plan.blocked,false);assert.ok(!plan.actions.some(a=>a.discovery_id===2));
});
test('contradictory not_reported history blocks all writes',()=>{
  const {source,target}=fixture();target.histories[0]={...target.histories[0],first_report_status:'not_reported',legacy_merit_credit:0};
  const plan=planHistory(source,target);assert.equal(plan.blocked,true);assert.equal(plan.conflicts[0].reason,'contradictory_not_reported');
  const db=memory(target);try {assert.throws(()=>applySynthetic(db,plan));assert.deepEqual(readTarget(db,target),target);}finally{db.close();}
});
test('missing and extra progress primary keys block the plan',()=>{
  for(const mutate of [t=>t.progress.pop(),t=>t.progress.push({...t.progress[0],profile_id:2})]) {
    const {source,target}=fixture();mutate(target);const plan=planHistory(source,target);assert.equal(plan.blocked,true);assert.equal(plan.primaryKeyMismatch,1);
  }
});
test('current progress, card, memo, timestamp or hold changes require review',()=>{
  for(const change of [{reported:0},{card_owned:1},{memo:'changed'},{updated_at:'changed'},{report_hold:1}]) {
    const {source,target}=fixture();Object.assign(target.progress[0],change);const plan=planHistory(source,target);assert.equal(plan.blocked,true);assert.equal(plan.progressDifferences,1);
  }
});
test('repeating an approved plan after re-reading creates no duplicates or further changes',()=>{
  const {source,target}=fixture();const db=memory(target);
  try {applySynthetic(db,planHistory(source,target));const after=readTarget(db,target);const again=planHistory(source,after);assert.equal(again.blocked,false);assert.equal(again.actions.length,0);applySynthetic(db,again);assert.deepEqual(readTarget(db,target),after);}finally{db.close();}
});
test('fault after a write rolls back all history and leaves progress intact',()=>{
  const {source,target}=fixture();const db=memory(target);
  try {assert.throws(()=>applySynthetic(db,planHistory(source,target),0),/Synthetic fault/);assert.deepEqual(readTarget(db,target),target);}finally{db.close();}
});
test('stale expected history is rejected within the transaction',()=>{
  const {source,target}=fixture();const plan=planHistory(source,target);const db=memory(target);
  try {db.exec("UPDATE discovery_reporting_history SET updated_at='another operation'");const before=readTarget(db,target);assert.throws(()=>applySynthetic(db,plan));assert.deepEqual(readTarget(db,target),before);}finally{db.close();}
});
test('same merit totals with a different eligible ID set are not equivalent',()=>{
  const {target}=fixture();const before=merit(target);const after=clone(before);after[0].eligibleIds=[2];assert.equal(before[0].knownMerit,after[0].knownMerit);assert.equal(sameMerit(before,after),false);
});
test('004 CHECK prohibits confirmed plus legacy=1',()=>{
  const {target}=fixture();const db=memory(target);try {assert.throws(()=>db.exec("UPDATE discovery_reporting_history SET first_report_status='confirmed'"),/CHECK constraint failed/);}finally{db.close();}
});
test('old zero with legacy-only or explicit unknown history is not guessed',()=>{
  for(const credit of [0,1]) {const {source,target}=fixture();target.histories.push({profile_id:1,discovery_id:2,first_report_status:'unknown',legacy_merit_credit:credit,updated_at:'later'});assert.equal(planHistory(source,target).blocked,true);}
});
test('profile identities and discovery identities must match',()=>{
  for(const mutate of [t=>t.profiles[0].name='other',t=>t.discoveries[0].gvdb_id=999]) {const {source,target}=fixture();mutate(target);assert.equal(planHistory(source,target).blocked,true);}
});
test('shared discovery IDs across profiles have independent histories and merits',()=>{
  const {source,target}=fixture();source.profiles.push({id:2,name:'synthetic B'});target.profiles=clone(source.profiles);
  const second={...source.progress[1],profile_id:2};source.progress.push(second);target.progress.push({...second,report_hold:0});
  const plan=planHistory(source,target);assert.equal(plan.blocked,false);assert.equal(plan.counts.notReportedInserts,2);assert.ok(sameMerit(plan.before,plan.after));assert.equal(plan.before[1].count,0);
});
test('wrong schema versions and duplicate keys are rejected before any application',()=>{
  for(const mutate of [(s,t)=>s.version=4,(s,t)=>t.version=3,(s,t)=>t.histories.push({...t.histories[0]})]) {
    const {source,target}=fixture();mutate(source,target);assert.equal(planHistory(source,target).blocked,true);
  }
});
