// Synthetic tests only: no file database, CLI, or external connection is accepted.
import { DatabaseSync, constants } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { planHistory, merit, sameMerit } from '../map-history-h1-plan.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export class RepairError extends Error {}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ident = name => '"' + name.replaceAll('"', '""') + '"';
export function requireCondition(value, reason) { if (!value) throw new RepairError(reason); }
const owned = new WeakMap();
const safePragmas = new Set(['database_list', 'table_info', 'integrity_check', 'quick_check', 'foreign_key_check', 'foreign_keys', 'query_only']);

export function createMemoryDatabase() {
  requireCondition(arguments.length === 0, 'Memory factory accepts no arguments');
  const native = new DatabaseSync(':memory:', { allowExtension: false });
  try {
    requireCondition(typeof native.setAuthorizer === 'function', 'Synthetic isolation requires Node.js 24.10 or later');
    native.exec('PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY');
    // SQLite authorization covers prepared statements, comments, parameters and VACUUM INTO.
    native.setAuthorizer((action, arg1, arg2) => {
      if ([constants.SQLITE_ATTACH, constants.SQLITE_DETACH, constants.SQLITE_CREATE_VTABLE].includes(action)) return constants.SQLITE_DENY;
      if (action === constants.SQLITE_PRAGMA && !safePragmas.has(arg1?.toLowerCase())) return constants.SQLITE_DENY;
      if (action === constants.SQLITE_FUNCTION && arg2?.toLowerCase() === 'load_extension') return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
    // Neither the connection nor native statements escape this closure.
    const facade = Object.freeze({
      exec(sql) { assertMemory(facade); native.exec(sql); },
      prepare(sql) {
        assertMemory(facade);
        const statement = native.prepare(sql);
        return Object.freeze(Object.fromEntries(['all', 'get', 'run'].map(method => [method, (...args) => {
          assertMemory(facade);
          return statement[method](...args);
        }])));
      },
      close() { if (owned.delete(facade)) native.close(); },
    });
    owned.set(facade, native);
    return facade;
  } catch (error) { native.close(); throw error; }
}

function assertMemory(db) {
  const native = owned.get(db);
  requireCondition(native !== undefined, 'Only a factory-owned memory database is accepted');
  const locations = native.prepare('PRAGMA database_list').all();
  requireCondition(locations.some(row => row.name === 'main') && locations.every(row => row.file === '' && ['main', 'temp'].includes(row.name)), 'File-backed or attached databases are forbidden');
}

const auto = readFileSync('src/discoveries/automaticReportingDiscoveries.sql', 'utf8')
  .replace('__SPECIAL_REPORTING_QUESTS__', readFileSync('src/discoveries/specialReportingQuests.sql', 'utf8'));

export function validateSchema(db,version) {
  assertMemory(db);
  const files=['001_initial.sql','002_quest_facets.sql','003_master_source_order.sql','004_map_report_hold.sql'];
  const names=['initial_schema','quest_facets','master_source_order','map_report_hold'];
  const rows=db.prepare('SELECT version,description,success,checksum FROM _sqlx_migrations ORDER BY version').all();
  requireCondition(rows.length===version,'Unexpected migration version');
  rows.forEach((r,i)=>requireCondition(r.version===i+1&&r.description===names[i]&&r.success===1&&
    Buffer.from(r.checksum).toString('hex')===createHash('sha384').update(readFileSync('src-tauri/migrations/'+files[i])).digest('hex'),'Migration identity mismatch'));
  requireCondition(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','Integrity failure');
  requireCondition(db.prepare('PRAGMA foreign_key_check').all().length===0,'Foreign key failure');
  if(version===4) {
    const columns=db.prepare('PRAGMA table_info(discovery_reporting_history)').all();
    requireCondition(['profile_id','discovery_id','first_report_status','legacy_merit_credit','updated_at'].every(name=>columns.some(c=>c.name===name)),'History schema missing');
    requireCondition(columns.find(c=>c.name==='profile_id').pk===1&&columns.find(c=>c.name==='discovery_id').pk===2,'History primary key mismatch');
    requireCondition(db.prepare('PRAGMA table_info(discovery_progress)').all().some(c=>c.name==='report_hold'),'Hold column missing');
  }
}

export function readData(db,version=4) {
  assertMemory(db);
  return {version,profiles:db.prepare('SELECT * FROM profiles ORDER BY id').all(),
    discoveries:db.prepare("SELECT d.id,d.gvdb_id,d.experience,d.is_active,c.name IS 'レリック' relic FROM discoveries d LEFT JOIN discovery_categories c ON c.id=d.category_id ORDER BY d.id").all(),
    progress:db.prepare('SELECT * FROM discovery_progress ORDER BY profile_id,discovery_id').all(),
    histories:version===4?db.prepare('SELECT * FROM discovery_reporting_history ORDER BY profile_id,discovery_id').all():[],
    automaticIds:db.prepare(auto).all().map(r=>r.discovery_id)};
}

export function businessFingerprint(db,layoutDb=db) {
  assertMemory(db); assertMemory(layoutDb);
  const limit=layoutDb.prepare('SELECT MAX(version) version FROM _sqlx_migrations').get().version;
  const tables=layoutDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'discovery_reporting_history' ORDER BY name").all();
  return hash(JSON.stringify(tables.map(({name})=>{
    const columns=layoutDb.prepare(`PRAGMA table_info(${ident(name)})`).all().map(c=>c.name);
    const rows=db.prepare(`SELECT ${columns.map(c=>`quote(${ident(c)})`).join(',')} FROM ${ident(name)}${name==='_sqlx_migrations'?` WHERE version<=${Number(limit)}`:''}`).all().map(r=>JSON.stringify(Object.values(r))).sort();
    return [name,rows];
  })));
}

export function schemaFingerprint(db) {
  assertMemory(db);
  return hash(JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()));
}

export function sqlMerit(db,profileId) {
  assertMemory(db);
  const sql=readFileSync('src/discoveries/meritEligibleDiscoveries.sql','utf8').replace('__AUTOMATIC_REPORTING_DISCOVERIES__',auto);
  const rows=db.prepare(`SELECT d.id,d.experience FROM (${sql}) e JOIN discoveries d ON d.id=e.discovery_id LEFT JOIN discovery_categories c ON c.id=d.category_id WHERE c.name IS NOT 'レリック' ORDER BY d.id`).all({'1':profileId});
  return {profileId,eligibleIds:rows.map(r=>r.id),count:rows.length,known:rows.filter(r=>r.experience!==null).length,
    unknown:rows.filter(r=>r.experience===null).length,knownMerit:rows.reduce((n,r)=>n+(r.experience??0),0)};
}

function historiesMatchProjected(reference,actual,actions) {
  const key=r=>`${r.profile_id}:${r.discovery_id}`;
  const expected=new Map(reference.histories.map(h=>[key(h),h]));
  for(const a of actions) expected.set(key(a),{profile_id:a.profile_id,discovery_id:a.discovery_id,
    first_report_status:a.first_report_status,legacy_merit_credit:a.legacy_merit_credit,updated_at:a.expected?.updated_at??null});
  if(actual.histories.length!==expected.size) return false;
  return actual.histories.every(h=>{
    const e=expected.get(key(h));if(!e)return false;
    return h.first_report_status===e.first_report_status&&h.legacy_merit_credit===e.legacy_merit_credit&&
      (e.updated_at===null?typeof h.updated_at==='string'&&Number.isFinite(Date.parse(h.updated_at)):h.updated_at===e.updated_at);
  });
}

export function inspectRepair(source,reference,target) {
  const intended=planHistory(source,reference);
  requireCondition(!intended.blocked,'Reference plan has conflicts');
  const current=planHistory(source,target);
  requireCondition(!current.blocked,'Target plan has conflicts or changed progress');
  const pending=equal(reference.histories,target.histories);
  const completed=current.actions.length===0&&historiesMatchProjected(reference,target,intended.actions);
  requireCondition(pending||completed,'Target history is neither the untouched reference nor the complete approved result');
  requireCondition(sameMerit(merit(reference),merit(target)),'Target merit/ID set differs from reference');
  return {intended,current,state:completed?'already-applied':'pending'};
}

export function applyRepair(db,source,reference,{validate,failAt=-1}={}) {
  assertMemory(db);
  validateSchema(db,4);
  const before=readData(db);
  const beforeBusiness=businessFingerprint(db), beforeSchema=schemaFingerprint(db);
  const initial=inspectRepair(source,reference,before);
  if(initial.state==='already-applied') return {updates:0,inserts:0,alreadyApplied:true};
  const expectedSql=reference.profiles.map(p=>sqlMerit(db,p.id));
  const createdAfter=Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    validateSchema(db,4);
    const fresh=readData(db);
    requireCondition(equal(fresh,before),'Target changed before transaction');
    const plan=inspectRepair(source,reference,fresh).current;
    validate?.('before',db);
    let updates=0,inserts=0;
    const update=db.prepare('UPDATE discovery_reporting_history SET first_report_status=?,legacy_merit_credit=? WHERE profile_id=? AND discovery_id=? AND first_report_status=? AND legacy_merit_credit=? AND updated_at=?');
    const insert=db.prepare('INSERT INTO discovery_reporting_history(profile_id,discovery_id,first_report_status,legacy_merit_credit) VALUES(?,?,?,?)');
    plan.actions.forEach((a,index)=>{
      const actual=db.prepare('SELECT * FROM discovery_reporting_history WHERE profile_id=? AND discovery_id=?').get(a.profile_id,a.discovery_id);
      requireCondition(equal(actual??null,a.expected),'Expected history changed');
      if(a.kind==='update') {
        const changed=update.run(a.first_report_status,a.legacy_merit_credit,a.profile_id,a.discovery_id,a.expected.first_report_status,a.expected.legacy_merit_credit,a.expected.updated_at);
        requireCondition(changed.changes===1,'Unexpected UPDATE count');updates++;
      } else {
        requireCondition(actual===undefined,'INSERT target already exists');
        const changed=insert.run(a.profile_id,a.discovery_id,a.first_report_status,a.legacy_merit_credit);
        requireCondition(changed.changes===1,'Unexpected INSERT count');inserts++;
      }
      if(index===failAt) throw Error('Synthetic transaction fault');
    });
    const after=readData(db);
    validateSchema(db,4);
    requireCondition(inspectRepair(source,reference,after).state==='already-applied','Incomplete approved history result');
    requireCondition(businessFingerprint(db)===beforeBusiness&&schemaFingerprint(db)===beforeSchema,'Business data or schema changed');
    requireCondition(sameMerit(expectedSql,after.profiles.map(p=>sqlMerit(db,p.id))),'SQL merit/ID set changed before commit');
    requireCondition(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok'&&db.prepare('PRAGMA foreign_key_check').all().length===0,'Pre-commit integrity failure');
    for(const a of plan.actions.filter(a=>a.kind==='insert')) {
      const time=Date.parse(db.prepare('SELECT updated_at FROM discovery_reporting_history WHERE profile_id=? AND discovery_id=?').get(a.profile_id,a.discovery_id).updated_at);
      requireCondition(time>=createdAfter-1000&&time<=Date.now()+1000,'New history timestamp is not the creation time');
    }
    validate?.('after',db);
    db.exec('COMMIT');
    return {updates,inserts,alreadyApplied:false,preCommitValidated:true};
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
