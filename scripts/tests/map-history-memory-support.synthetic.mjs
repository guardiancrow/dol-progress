import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryDatabase, applyRepair, readData, validateSchema } from './map-history-memory-support.mjs';

test('factory accepts no path, URI, or external handle', () => {
  const external = new DatabaseSync(':memory:');
  try {
    external.exec('CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES(7)');
    for (const value of ['synthetic.db', 'file:synthetic.db', external]) assert.throws(() => createMemoryDatabase(value), /no arguments/);
    for (const operation of [() => applyRepair(external, {}, {}), () => readData(external), () => validateSchema(external, 4)]) assert.throws(operation, /factory-owned/);
    assert.equal(external.prepare('SELECT value FROM sentinel').get().value, 7);
  } finally { external.close(); }
});

test('foreign and forged handles are refused before any method is called', () => {
  let touched = false;
  const fake = { prepare() { touched = true; throw Error('must not be called'); } };
  assert.throws(() => applyRepair(fake, {}, {}), /factory-owned/);
  assert.equal(touched, false);
});

test('memory facade and statements expose no connection or authorizer escape', () => {
  const db = createMemoryDatabase();
  try {
    assert.equal(Object.isFrozen(db), true);
    assert.deepEqual(Object.keys(db).sort(), ['close', 'exec', 'prepare']);
    const statement = db.prepare('SELECT 1 AS value');
    assert.equal(Object.isFrozen(statement), true);
    assert.deepEqual(Object.keys(statement).sort(), ['all', 'get', 'run']);
    assert.equal(statement.get().value, 1);
    assert.throws(() => { db.setAuthorizer = () => {}; }, TypeError);
  } finally { db.close(); }
  assert.throws(() => db.exec('SELECT 1'), /factory-owned/);
});

test('ATTACH through exec, prepared parameters and VACUUM INTO never creates a file', () => {
  const root = mkdtempSync(join(tmpdir(), 'dol-memory-boundary-'));
  const target = join(root, 'synthetic-only.sqlite');
  const literal = target.replaceAll("'", "''");
  const db = createMemoryDatabase();
  try {
    for (const sql of [`ATTACH DATABASE '${literal}' AS other`, `/* synthetic */ AtTaCh '${literal}' AS other`, `VACUUM INTO '${literal}'`, "ATTACH ':memory:' AS other"]) assert.throws(() => db.exec(sql), /authoriz/i);
    assert.throws(() => db.prepare('ATTACH DATABASE ? AS other'), /authoriz/i);
    assert.throws(() => db.exec(`PRAGMA temp_store_directory='${literal}'`), /authoriz/i);
    assert.throws(() => db.exec("SELECT load_extension('synthetic-only')"), /authoriz/i);
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(root), []);
    assert.equal(db.prepare('PRAGMA database_list').all().length, 1);
  } finally { db.close(); rmdirSync(root); }
});
