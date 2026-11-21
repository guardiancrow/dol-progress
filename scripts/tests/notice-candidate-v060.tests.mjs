import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, validateCandidate } from '../notice-candidates/v0.6.0.mjs';
import { readRegisteredNoticeInput } from '../notice-approval-binding.mjs';
import { sha256 } from '../release-input-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const prefix = 'release/notices/v0.6.0/';
const notice = prefix + 'THIRD-PARTY-NOTICES.txt';
const published = 'c63d60f01303f7057176b4f99be5e9e1d1aa9dda';
const bytes = name => readFileSync(new URL('../../' + name, import.meta.url));
const candidate = prepareCandidate();
const cli = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });

function replace(name, edit, gate) {
  const file = prefix + name;
  const changed = JSON.parse(candidate.get(file));
  edit(changed);
  const read = relative => relative === file ? Buffer.from(JSON.stringify(changed, null, 2) + '\n') : candidate.get(relative);
  assert.throws(() => validateCandidate(candidate, read), gate);
}

test('reconstruction is deterministic and on-disk candidate files are byte-for-byte reproducible', () => {
  assert.deepEqual(prepareCandidate(), candidate);
  const audit = validateCandidate(candidate);
  assert.equal(audit.status, 'PREPARED');
  assert.equal(audit.technical_validation, true);
  assert.equal(typeof audit.preparation_sha256, 'string');
  for (const key of ['input_approval', 'verification_approval', 'formal_approval', 'public_release_approved']) {
    assert.equal(audit[key], false);
  }
  assert.deepEqual([audit.included, audit.excluded, audit.original_texts, audit.references], [201, 6, 149, 358]);
});

test('the notice changes one header byte and Git filtering preserves every candidate input', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const old = git('show', `${published}:THIRD-PARTY-NOTICES.txt`);
  const newNotice = candidate.get(notice);
  const offset = Buffer.byteLength('DOL Progress Manager 0.');
  assert.equal(old[offset], '5'.charCodeAt(0));
  old[offset] = '6'.charCodeAt(0);
  assert(newNotice.equals(old), 'Only the product version digit may differ');
  const snapshot = JSON.parse(bytes(prefix + 'preparation.json'));
  assert.equal(Object.hasOwn(snapshot.candidate_input_sha256, prefix + 'preparation.json'), false);
  assert.equal(Object.hasOwn(snapshot, 'candidate_commit'), false);
  for (const name of new Set([...Object.keys(snapshot.candidate_input_sha256), ...Object.keys(snapshot.candidate_tooling_sha256), prefix + 'preparation.json'])) {
    assert.deepEqual(git('hash-object', '--path=' + name, '--', name), git('hash-object', '--no-filters', '--', name), name);
  }
  for (const [name, expected] of Object.entries(snapshot.candidate_input_sha256)) assert.equal(sha256(bytes(name)), expected);
});

test('a notice change outside the product version is refused', () => {
  const changed = Buffer.concat([candidate.get(notice), Buffer.from('unexpected\n')]);
  assert.throws(() => validateCandidate(candidate, name => name === notice ? changed : candidate.get(name)), /candidate_bytes/);
});

test('altered metadata hashes and coverage or exclusion changes are refused', () => {
  replace('manifest.json', m => { m.notices_sha256 = '0'.repeat(64); }, /candidate_bytes/);
  replace('review.json', r => { r.coverage[0].selected_license = 'OTHER'; }, /candidate_bytes/);
  replace('review.json', r => { r.coverage.find(record => !record.included).exclusion_reason = 'changed'; }, /candidate_bytes/);
  replace('preparation.json', p => { p.candidate_toolchain.node = 'v0.0.0'; }, /candidate_bytes/);
});

test('a changed dependency in either lockfile is refused before candidate generation', () => {
  for (const [name, before, after] of [
    ['package-lock.json', '"version": "19.2.8"', '"version": "19.2.9"'],
    ['src-tauri/Cargo.lock', 'version = "0.8.6"', 'version = "0.8.7"'],
  ]) {
    const old = bytes(name).toString('utf8');
    const changed = Buffer.from(old.replace(before, after));
    assert.notDeepEqual(changed, bytes(name));
    assert.throws(() => prepareCandidate(path => path === name ? changed : bytes(path)), /application_version_bytes/);
  }
});

test('mixed version metadata and an arbitrary canonical path are refused', () => {
  replace('inventory.json', i => { i.version = '0.5.0'; }, /candidate_version/);
  replace('source.json', s => { s.canonical_file = '../THIRD-PARTY-NOTICES.txt'; }, /candidate_canonical_path/);
});

test('a REVIEWED label or an invented approval has no effect', () => {
  replace('review.json', r => { r.status = 'REVIEWED'; }, /candidate_must_be_prepared/);
  replace('preparation.json', p => { p.final_review.approved = true; }, /candidate_bytes/);
  // Promotion uses this registration reader before considering any write.
  assert.throws(() => readRegisteredNoticeInput(root, '0.6.0'), { gate: 'owner_approval_not_registered' });
});

test('technical entry point accepts only v0.6.0 and formal input audit still rejects it', () => {
  const script = 'scripts/notice-candidates/v0.6.0.mjs';
  const technical = cli(script, '--version', '0.6.0');
  assert.equal(technical.status, 0, technical.stderr);
  assert.deepEqual(JSON.parse(technical.stdout), validateCandidate(candidate));
  for (const args of [['--version', '9.9.9'], ['--formal']]) {
    const rejected = cli(script, ...args);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unsupported_candidate_arguments/);
  }
  const head = 'aefee8711628dda824590d4448ddf0103cde6906';
  const formal = cli('scripts/release-input-audit.mjs', '--version', '0.6.0', '--formal', '--expected-source-head', head);
  assert.notEqual(formal.status, 0);
  assert.match(formal.stderr, /unsupported_release_version/);
});
