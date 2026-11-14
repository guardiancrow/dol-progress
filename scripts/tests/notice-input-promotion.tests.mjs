import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMetadataTransaction } from '../notice-input-promotion.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dol-promotion-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dol-promotion-test-'));
    fs.rmSync(resolved, { recursive: true });
  });
  const before = new Map(), after = new Map();
  fs.mkdirSync(path.join(root, 'release/notices/v9.8.7'), { recursive: true });
  for (const name of ['manifest', 'review', 'source']) {
    const p = 'release/notices/v9.8.7/' + name + '.json';
    before.set(p, Buffer.from('{"fixture":"TEST_ONLY","state":"PREPARED"}\n'));
    after.set(p, Buffer.from('{"fixture":"TEST_ONLY","state":"REVIEWED"}\n'));
    fs.writeFileSync(path.join(root, p), before.get(p));
  }
  return { root, before, after };
}
test('TEST_ONLY metadata transaction writes exactly the three planned files', t => {
  const f = fixture(t), r = applyMetadataTransaction(f.root, '9.8.7', f.before, f.after);
  assert.equal(r.files_written, 3); assert.equal(r.formal_approval, false);
  for (const [p, b] of f.after) assert.deepEqual(fs.readFileSync(path.join(f.root, p)), b);
});
test('mismatched precondition is rejected before any write', t => {
  const f = fixture(t), p = [...f.before.keys()][1]; fs.writeFileSync(path.join(f.root, p), 'TEST_ONLY external change');
  assert.throws(() => applyMetadataTransaction(f.root, '9.8.7', f.before, f.after), e => e.gate === 'promotion_precondition');
  assert.deepEqual(fs.readFileSync(path.join(f.root, [...f.before.keys()][0])), [...f.before.values()][0]);
  assert.equal(fs.existsSync(path.join(f.root, 'tmp')), false);
});
test('partial rename failure restores original bytes', t => {
  const f = fixture(t), rename = fs.renameSync; let calls = 0;
  const mock = t.mock.method(fs, 'renameSync', (...args) => { if (++calls === 2) throw Error('TEST_ONLY injected failure'); return rename(...args); });
  assert.throws(() => applyMetadataTransaction(f.root, '9.8.7', f.before, f.after), e => e.gate === 'promotion_write_failed_rolled_back');
  mock.mock.restore();
  for (const [p, b] of f.before) assert.deepEqual(fs.readFileSync(path.join(f.root, p)), b);
});
test('extra files and traversal cannot extend the promotion scope', t => {
  const f = fixture(t); f.after.set('release/notices/v9.8.7/../approval.json', Buffer.from('TEST_ONLY'));
  assert.throws(() => applyMetadataTransaction(f.root, '9.8.7', f.before, f.after), e => e.gate === 'promotion_scope');
  for (const [p, b] of f.before) assert.deepEqual(fs.readFileSync(path.join(f.root, p)), b);
});
