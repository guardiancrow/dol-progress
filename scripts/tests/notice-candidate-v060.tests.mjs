import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, validateCandidate } from '../notice-candidates/v0.6.0.mjs';
import { inspectNoticeInputApproval, readRegisteredNoticeInput, reviewedNoticeMetadata } from '../notice-approval-binding.mjs';
import { sha256 } from '../release-input-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const prefix = 'release/notices/v0.6.0/';
const notice = prefix + 'THIRD-PARTY-NOTICES.txt';
const published = 'c63d60f01303f7057176b4f99be5e9e1d1aa9dda';
const fixed = 'de8e98616dffd216ead37c9b61dfb109cac963ea';
const bytes = name => readFileSync(new URL('../../' + name, import.meta.url));
const candidate = prepareCandidate();
const cli = (script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const fixedBytes = name => git('show', `${fixed}:${name}`);

function replace(name, edit, gate) {
  const file = prefix + name;
  const changed = JSON.parse(candidate.get(file));
  edit(changed);
  const read = relative => relative === file ? Buffer.from(JSON.stringify(changed, null, 2) + '\n') : candidate.get(relative);
  assert.throws(() => validateCandidate(candidate, read), gate);
}

test('reconstruction is deterministic and matches the fixed PREPARED blobs', () => {
  assert.deepEqual(prepareCandidate(), candidate);
  const audit = validateCandidate(candidate, fixedBytes);
  assert.equal(audit.status, 'PREPARED');
  assert.equal(audit.technical_validation, true);
  assert.equal(typeof audit.preparation_sha256, 'string');
  for (const key of ['input_approval', 'verification_approval', 'formal_approval', 'public_release_approved']) {
    assert.equal(audit[key], false);
  }
  assert.deepEqual([audit.included, audit.excluded, audit.original_texts, audit.references], [201, 6, 149, 358]);
});

test('the notice changes one header byte and Git filtering preserves every candidate input', () => {
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
  for (const [name, expected] of Object.entries(snapshot.candidate_input_sha256)) assert.equal(sha256(fixedBytes(name)), expected);
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
});

test('the fixed candidate validates and formal input audit still rejects it without code approval', () => {
  const script = 'scripts/notice-candidates/v0.6.0.mjs';
  const technical = cli('scripts/release-input-audit.mjs', '--version', '0.6.0', '--candidate');
  assert.equal(technical.status, 0, technical.stderr);
  assert.deepEqual(JSON.parse(technical.stdout), {
    ...validateCandidate(candidate, fixedBytes), scope: 'FIXED_CANDIDATE_ARCHIVE', candidate_commit: fixed,
  });
  for (const args of [['--version', '9.9.9'], ['--formal']]) {
    const rejected = cli(script, ...args);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /unsupported_candidate_arguments/);
  }
  const formal = cli('scripts/release-input-audit.mjs', '--version', '0.6.0', '--formal', '--expected-source-head', fixed);
  assert.notEqual(formal.status, 0);
  assert.match(formal.stderr, /implementation_review_pending/);
});

test('the v0.6.0 input decision permits only the deterministic three-file transition', async t => {
  const { model, pin } = readRegisteredNoticeInput(root, '0.6.0');
  const approved = inspectNoticeInputApproval(model, pin);
  assert.deepEqual(approved, {
    version: '0.6.0', status: 'REVIEWED', input_approval: true, verification_approval: false,
    formal_approval: false, public_release_approved: false,
  });
  const reviewed = reviewedNoticeMetadata(model, pin);
  assert.deepEqual([...reviewed.keys()].sort(), ['manifest', 'review', 'source'].map(name => prefix + name + '.json'));
  const preparedFiles = new Map(model.currentFiles);
  for (const [name, value] of reviewed) {
    assert(value.equals(bytes(name)), name);
    preparedFiles.set(name, model.candidateFiles.get(name));
  }
  assert.deepEqual(inspectNoticeInputApproval({ ...model, currentFiles: preparedFiles }, pin), { ...approved, status: 'PREPARED' });
  assert.deepEqual(reviewedNoticeMetadata({ ...model, currentFiles: preparedFiles }, pin), reviewed);

  await t.test('different SHA, snapshot, approval file or registry hash fail closed', () => {
    assert.throws(() => inspectNoticeInputApproval({ ...model, candidateCommit: '0'.repeat(40) }, pin), { gate: 'candidate_identity' });
    assert.throws(() => inspectNoticeInputApproval({ ...model, snapshotBytes: Buffer.from('{}') }, pin), { gate: 'snapshot_hash' });
    assert.throws(() => inspectNoticeInputApproval({ ...model, approvalBytes: Buffer.from('{}') }, pin), { gate: 'approval_hash' });
    assert.throws(() => inspectNoticeInputApproval(model, { ...pin, approval_sha256: '0'.repeat(64) }), { gate: 'approval_hash' });
  });
  await t.test('mixed metadata, altered coverage and partial promotion are rejected', () => {
    const currentFiles = new Map(model.currentFiles);
    const review = prefix + 'review.json';
    const mixed = JSON.parse(currentFiles.get(review));
    mixed.version = '0.5.0';
    currentFiles.set(review, Buffer.from(JSON.stringify(mixed)));
    assert.throws(() => inspectNoticeInputApproval({ ...model, currentFiles }, pin), { gate: 'reviewed_transition' });
    mixed.version = '0.6.0';
    mixed.coverage.pop();
    currentFiles.set(review, Buffer.from(JSON.stringify(mixed)));
    assert.throws(() => inspectNoticeInputApproval({ ...model, currentFiles }, pin), { gate: 'reviewed_transition' });
    currentFiles.set(review, preparedFiles.get(review));
    assert.throws(() => inspectNoticeInputApproval({ ...model, currentFiles }, pin), { gate: 'partial_transition' });
  });
  await t.test('unapproved original or lockfile changes are rejected', () => {
    const currentFiles = new Map(model.currentFiles);
    currentFiles.set('src-tauri/Cargo.lock', Buffer.from('changed lockfile'));
    assert.throws(() => inspectNoticeInputApproval({ ...model, currentFiles }, pin), { gate: 'current_input_hash' });
    const inheritedFiles = new Map(model.inheritedFiles);
    const original = [...inheritedFiles.keys()].find(name => name.startsWith('release/notices/texts/'));
    inheritedFiles.set(original, Buffer.from('changed original'));
    assert.throws(() => inspectNoticeInputApproval({ ...model, inheritedFiles }, pin), { gate: 'current_inherited_input_hash' });
  });
});
