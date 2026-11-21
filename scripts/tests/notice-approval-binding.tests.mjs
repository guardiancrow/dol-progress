import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectNoticeApprovalBinding, inspectNoticeInputApproval, reviewedNoticeMetadata, verifyRegisteredNoticeApproval } from '../notice-approval-binding.mjs';
import { approvedNoticeDecisions, approvedVerificationDecisions } from '../notice-approval-decisions.mjs';

// Synthetic records exist only in memory. They are never actual Owner evidence.
const hash = b => createHash('sha256').update(b).digest('hex');
const encode = v => Buffer.from(JSON.stringify(v, null, 2) + '\n');
function fixture(version = '9.8.7') {
  const prefix = `release/notices/v${version}/`, commit = 'a'.repeat(40);
  const input = new Map([
    ['package.json', encode({ version, purpose: 'TEST_ONLY' })],
    ['THIRD-PARTY-NOTICES.txt', Buffer.from('TEST_ONLY inherited synthetic notice\r\n')],
    ['scripts/example-audit.mjs', Buffer.from('// TEST_ONLY candidate tooling\n')],
    [prefix + 'inventory.json', encode({ version, components: ['TEST_ONLY'] })],
    [prefix + 'review.json', encode({ version, status: 'PREPARED', unresolved: ['TEST_ONLY pending'], coverage: ['TEST_ONLY'] })],
    [prefix + 'source.json', encode({ version, formal_review_state: 'PREPARED', source_role: 'TEST_ONLY candidate', source_commit: 'c'.repeat(40) })],
  ]);
  input.set(prefix + 'manifest.json', encode({ version, status: 'PREPARED', unresolved: ['TEST_ONLY pending'],
    inventory_sha256: hash(input.get(prefix + 'inventory.json')), review_sha256: hash(input.get(prefix + 'review.json')),
    source_sha256: hash(input.get(prefix + 'source.json')) }));
  const toolchain = { rustc: ['TEST_ONLY rustc'], cargo: 'TEST_ONLY cargo', node: 'TEST_ONLY node', npm: 'TEST_ONLY npm', tauri_cli: 'TEST_ONLY cli', powershell: 'TEST_ONLY powershell' };
  const toolchainHash = hash(Buffer.from(Object.entries(toolchain).map(([k, v]) => k + '=' + [v].flat().join('\n')).join('\n') + '\n'));
  const snapshotPath = prefix + 'preparation.json', approvalPath = prefix + 'approval.json';
  const snapshot = { version, state: 'PREPARED', final_review: { approved: false }, public_release_approved: false,
    candidate_toolchain: toolchain, candidate_toolchain_sha256: toolchainHash,
    approval_scope: ['TEST_ONLY notice and toolchain'], excluded_scope: ['TEST_ONLY binary publication'],
    candidate_input_sha256: Object.fromEntries([...input].map(([p, b]) => [p, hash(b)])) };
  const snapshotBytes = encode(snapshot);
  const tooling = new Map([['scripts/.gitattributes', Buffer.from('# TEST_ONLY LF attributes\n')], ['scripts/example-audit.mjs', Buffer.from('// TEST_ONLY reviewed tooling\n')],
    ['scripts/notice-input-promotion.mjs', Buffer.from('// TEST_ONLY promotion\n')],
    ['scripts/notice-approval-binding.mjs', Buffer.from('// TEST_ONLY verifier\n')]]);
  const reviewedTooling = Object.fromEntries([...tooling].map(([p, b]) => [p, hash(b)]));
  const approvalRecord = { schema: 2, purpose: 'NOTICE_OWNER_INPUT_APPROVAL', version, state: 'APPROVED',
    approved_by: 'Owner', approved_on: '2024-01-02', approved_date_status: 'EXPLICIT_DATE',
    basis: 'OWNER_EXPLICIT_FIXED_SNAPSHOT_APPROVAL', candidate_commit: commit,
    snapshot_path: snapshotPath, snapshot_sha256: hash(snapshotBytes), scope: snapshot.approval_scope,
    excludes: [...snapshot.excluded_scope, 'Unconditional approval of additional or changed verification code', 'Final ZIP acceptance'],
    toolchain_sha256: toolchainHash, verification_review: 'SEPARATE_OWNER_REVIEW_REQUIRED', public_release_approved: false };
  const approvalBytes = encode(approvalRecord);
  const pin = { version, candidate_commit: commit, snapshot_path: snapshotPath, snapshot_sha256: hash(snapshotBytes),
    approval_path: approvalPath, approval_sha256: hash(approvalBytes), approved_by: 'Owner', approved_on: '2024-01-02', approved_date_status: 'EXPLICIT_DATE',
    toolchain_sha256: toolchainHash, reviewed_tooling_sha256: reviewedTooling };
  const current = new Map(input);
  current.set(snapshotPath, snapshotBytes); current.set(approvalPath, approvalBytes);
  for (const [p, b] of tooling) current.set(p, b);
  const evidence = { path: approvalPath, sha256: hash(approvalBytes) };
  const candidate = { commit, path: snapshotPath, sha256: hash(snapshotBytes) };
  const read = name => JSON.parse(input.get(prefix + name));
  current.set(prefix + 'review.json', encode({ ...read('review.json'), status: 'REVIEWED', unresolved: [], owner_approval: evidence, approved_candidate: candidate }));
  current.set(prefix + 'source.json', encode({ ...read('source.json'), formal_review_state: 'REVIEWED',
    formal_package_gate: 'PENDING_FORMAL_VERIFICATION', source_role: 'Release scope baseline; approved candidate is identified separately.', owner_approval: evidence, approved_candidate: candidate }));
  current.set(prefix + 'manifest.json', encode({ ...read('manifest.json'), status: 'REVIEWED', unresolved: [],
    owner_approval: evidence, approved_candidate: candidate, review_sha256: hash(current.get(prefix + 'review.json')),
    source_sha256: hash(current.get(prefix + 'source.json')) }));
  return { prefix, pin, model: { version, candidateCommit: commit, snapshotBytes, candidateFiles: input,
    currentFiles: current, approvalBytes,
    source: { head: 'b'.repeat(40), expectedHead: 'b'.repeat(40), signatureVerified: true, clean: true, candidateIsAncestor: true } } };
}
function rejects(name, mutate, gate) {
  test(name, () => { const f = fixture(); mutate(f); assert.throws(() => inspectNoticeApprovalBinding(f.model, f.pin), e => e.gate === gate); });
}
const editCurrent = (f, name, action) => { const p = f.prefix + name, v = JSON.parse(f.model.currentFiles.get(p)); action(v); f.model.currentFiles.set(p, encode(v)); };
function editApproval(f, action) {
  const v = JSON.parse(f.model.approvalBytes); action(v); f.model.approvalBytes = encode(v);
  // Test deeper semantic guards even if an attacker rehashes their forged record.
  f.pin.approval_sha256 = hash(f.model.approvalBytes);
}

for (const version of ['9.8.7', '10.0.0']) test(`TEST_ONLY binding normal case for ${version} never grants approval`, () => {
  const { model, pin } = fixture(version), r = inspectNoticeApprovalBinding(model, pin);
  assert.equal(r.binding_validated, true); assert.equal(r.formal_approval, false); assert.equal(r.public_release_approved, false);
});
test('real input and separate code approval bind only the reviewed implementation snapshot', () => {
  assert.equal(approvedNoticeDecisions['0.5.0'].candidate_commit, '57f0325f1daaa699569c82c221de35ddc2a79605');
  assert.deepEqual(Object.keys(approvedVerificationDecisions), ['0.5.0']);
  const decision = approvedVerificationDecisions['0.5.0'];
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bytes = fs.readFileSync(path.join(root, decision.implementation_snapshot_path));
  assert.equal(hash(bytes), '023112f1a0bd52ace3192cc2f43a13a95270765404cf0bfaf08c6a03fd0acedc');
  assert.equal(decision.implementation_snapshot_sha256, hash(bytes));
  const snapshot = JSON.parse(bytes);
  assert.equal(snapshot.state, 'PREPARED'); assert.equal(snapshot.approved, false);
  assert.equal(decision.candidate_commit, snapshot.candidate_commit);
  assert.equal(decision.snapshot_sha256, snapshot.snapshot_sha256);
  assert.deepEqual(decision.reviewed_tooling_sha256, snapshot.file_sha256);
  assert.equal(Object.keys(decision.reviewed_tooling_sha256).length, 8);
  for (const [name, sha] of Object.entries(decision.reviewed_tooling_sha256)) {
    const original = execFileSync('git', ['show', `${decision.reviewed_commit}:${name}`], { cwd: root });
    assert.equal(hash(original), sha);
  }
  assert.equal(decision.reviewed_commit, 'a92a6bdc60a011d153b9b042a973895762905f8b');
  assert.equal(decision.reviewed_pr, 12); assert.equal(decision.approved_by, 'Owner');
  assert.equal(decision.approved_on, null); assert.equal(decision.approved_date_status, 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION');
  assert.equal(decision.public_release_approved, false);
  assert.equal(Object.isFrozen(decision), true); assert.equal(Object.isFrozen(decision.reviewed_tooling_sha256), true);
  assert.equal(Object.isFrozen(approvedNoticeDecisions), true);
  assert.equal(Object.isFrozen(approvedVerificationDecisions), true);
});
test('self-declared approval or caller-supplied pin cannot enable a real version', () => {
  const f = fixture('0.5.0');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const expectedGate = version === '0.5.0' ? 'source_identity' : 'current_input_hash';
  assert.throws(() => verifyRegisteredNoticeApproval(root, '0.5.0', 'b'.repeat(40), f.pin), { gate: expectedGate });
  assert.throws(() => verifyRegisteredNoticeApproval('TEST_ONLY', '9.8.7', 'b'.repeat(40)), e => e.gate === 'owner_approval_not_registered');
});
rejects('changed snapshot bytes rejected', f => { f.model.snapshotBytes = Buffer.concat([f.model.snapshotBytes, Buffer.from(' ')]); }, 'snapshot_hash');
rejects('another candidate commit rejected', f => { f.model.candidateCommit = 'd'.repeat(40); }, 'candidate_identity');
rejects('another version rejected', f => { f.model.version = '1.2.3'; }, 'candidate_identity');
rejects('candidate input change rejected', f => { f.model.candidateFiles.set('package.json', Buffer.from('TEST_ONLY changed')); }, 'candidate_input_hash');
rejects('candidate input EOL conversion rejected', f => { const p = 'THIRD-PARTY-NOTICES.txt'; f.model.candidateFiles.set(p, Buffer.from(f.model.candidateFiles.get(p).toString().replaceAll('\r\n', '\n'))); }, 'candidate_input_hash');
rejects('approval byte change rejected without a trusted hash update', f => { f.model.approvalBytes = Buffer.concat([f.model.approvalBytes, Buffer.from('\n')]); }, 'approval_hash');
rejects('forged date rejected even after self-rehash', f => editApproval(f, x => { x.approved_on = '2024-01-03'; }), 'approval_decision');
rejects('wrong-version approval rejected after self-rehash', f => editApproval(f, x => { x.version = '1.2.3'; }), 'approval_decision');
rejects('extended approval scope rejected after self-rehash', f => editApproval(f, x => { x.scope.push('TEST_ONLY extra rights'); }), 'approval_decision');
rejects('publication cannot be enabled by notice approval', f => editApproval(f, x => { x.public_release_approved = true; }), 'approval_decision');
rejects('input approval cannot self-approve implementation', f => editApproval(f, x => { x.verification_review = 'APPROVED'; }), 'approval_decision');
rejects('implementation hashes cannot be inserted into an input-only decision', f => editApproval(f, x => { x.reviewed_tooling_sha256 = f.pin.reviewed_tooling_sha256; }), 'approval_decision');
rejects('snapshot relabel cannot become its own approval', f => {
  const s = JSON.parse(f.model.snapshotBytes); s.state = 'REVIEWED'; f.model.snapshotBytes = encode(s); f.pin.snapshot_sha256 = hash(f.model.snapshotBytes);
}, 'prepared_snapshot');
rejects('invalid toolchain fingerprint rejected after snapshot rehash', f => {
  const s = JSON.parse(f.model.snapshotBytes); s.candidate_toolchain.node = 'TEST_ONLY changed';
  f.model.snapshotBytes = encode(s); f.pin.snapshot_sha256 = hash(f.model.snapshotBytes);
}, 'toolchain_fingerprint');
rejects('label-only REVIEWED change rejected', f => {
  const p = f.prefix + 'review.json', x = JSON.parse(f.model.candidateFiles.get(p)); x.status = 'REVIEWED';
  f.model.currentFiles.set(p, encode(x));
}, 'reviewed_transition');
rejects('coverage edit outside promotion rejected', f => editCurrent(f, 'review.json', x => { x.coverage.push('TEST_ONLY invented'); }), 'reviewed_transition');
rejects('changed inventory rejected', f => { f.model.currentFiles.set(f.prefix + 'inventory.json', Buffer.from('TEST_ONLY changed')); }, 'current_input_hash');
rejects('changed current payload rejected', f => { f.model.currentFiles.set('package.json', Buffer.from('TEST_ONLY changed')); }, 'current_input_hash');
rejects('current metadata EOL normalization rejected', f => {
  const p = f.prefix + 'source.json'; f.model.currentFiles.set(p, Buffer.from(f.model.currentFiles.get(p).toString().replaceAll('\n', '\r\n')));
}, 'reviewed_transition');
rejects('current tooling must match separately reviewed bytes', f => { f.model.currentFiles.set('scripts/example-audit.mjs', Buffer.from('// TEST_ONLY altered\n')); }, 'reviewed_tooling_hash');
rejects('reviewed Git attributes cannot drift', f => { f.model.currentFiles.set('scripts/.gitattributes', Buffer.from('# TEST_ONLY altered attributes\n')); }, 'reviewed_tooling_hash');
rejects('old snapshot cannot be replaced in current source', f => { f.model.currentFiles.set(f.pin.snapshot_path, Buffer.from('TEST_ONLY changed')); }, 'current_snapshot');
rejects('unregistered tooling cannot be omitted after self-rehash', f => {
  delete f.pin.reviewed_tooling_sha256['scripts/notice-approval-binding.mjs'];
}, 'tooling_scope');
rejects('unknown current input rejected', f => { f.model.currentFiles.set('TEST_ONLY-extra.json', Buffer.from('{}')); }, 'current_file_set');
rejects('unknown candidate input rejected', f => { f.model.candidateFiles.set('TEST_ONLY-extra.json', Buffer.from('{}')); }, 'candidate_file_set');
for (const name of ['signatureVerified', 'clean', 'candidateIsAncestor']) rejects(`source guard ${name} is mandatory`, f => { f.model.source[name] = false; }, 'source_guards');
rejects('wrong final source head rejected', f => { f.model.source.expectedHead = 'd'.repeat(40); }, 'source_identity');
rejects('candidate commit is not the final promoted source', f => { f.model.source.head = f.pin.candidate_commit; f.model.source.expectedHead = f.pin.candidate_commit; }, 'source_identity');
test('input approval accepts the deterministic promoted metadata without approving code', () => {
  const f = fixture(); f.model.currentFiles.set('scripts/example-audit.mjs', Buffer.from('TEST_ONLY unreviewed code'));
  const result = inspectNoticeInputApproval(f.model, f.pin);
  assert.equal(result.status, 'REVIEWED'); assert.equal(result.input_approval, true);
  assert.equal(result.verification_approval, false); assert.equal(result.formal_approval, false);
});
test('prepared input approval and partial promotion are distinct', () => {
  const f = fixture();
  for (const name of ['manifest', 'review', 'source']) f.model.currentFiles.set(f.prefix + name + '.json', f.model.candidateFiles.get(f.prefix + name + '.json'));
  assert.equal(inspectNoticeInputApproval(f.model, f.pin).status, 'PREPARED');
  f.model.currentFiles.set(f.prefix + 'review.json', reviewedNoticeMetadata(f.model, f.pin).get(f.prefix + 'review.json'));
  assert.throws(() => inspectNoticeInputApproval(f.model, f.pin), e => e.gate === 'partial_transition');
});
test('an explicitly unspecified date stays null, never inferred', () => {
  const f = fixture(); f.pin.approved_on = null; f.pin.approved_date_status = 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION';
  editApproval(f, x => { x.approved_on = null; x.approved_date_status = 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION'; });
  f.model.currentFiles.set(f.pin.approval_path, f.model.approvalBytes);
  for (const [p, b] of reviewedNoticeMetadata(f.model, f.pin)) f.model.currentFiles.set(p, b);
  assert.equal(inspectNoticeInputApproval(f.model, f.pin).input_approval, true);
});
test('new scoped attributes preserve both approval-code LF and ordinary Windows checkout behavior', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dol-approval-eol-test-'));
  try {
    const git = args => execFileSync('git', ['-C', fixtureRoot, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '--quiet']);
    fs.mkdirSync(path.join(fixtureRoot, 'scripts/tests'), { recursive: true });
    for (const p of ['.gitattributes', 'scripts/.gitattributes']) fs.writeFileSync(path.join(fixtureRoot, p), fs.readFileSync(path.join(root, p)));
    const fixed = ['scripts/notice-approval-binding.mjs', 'scripts/notice-approval-decisions.mjs',
      'scripts/tests/notice-approval-binding.tests.mjs', 'scripts/release-input-audit.mjs', 'scripts/portable-package-safety.ps1'];
    const ordinary = ['README.md', 'scripts/tests/portable-package.tests.ps1'];
    for (const p of [...fixed, ...ordinary]) fs.writeFileSync(path.join(fixtureRoot, p), 'TEST_ONLY\nsynthetic bytes\n');
    git(['add', '--', '.']);
    for (const setting of ['true', 'false', 'input']) {
      for (const p of [...fixed, ...ordinary]) fs.unlinkSync(path.join(fixtureRoot, p));
      git(['-c', 'core.autocrlf=' + setting, 'checkout-index', '--all', '--force']);
      for (const p of fixed) assert.equal(fs.readFileSync(path.join(fixtureRoot, p), 'utf8'), 'TEST_ONLY\nsynthetic bytes\n');
      for (const p of ordinary) assert.equal(fs.readFileSync(path.join(fixtureRoot, p), 'utf8'), setting === 'true' ? 'TEST_ONLY\r\nsynthetic bytes\r\n' : 'TEST_ONLY\nsynthetic bytes\n');
    }
  } finally {
    const resolved = path.resolve(fixtureRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dol-approval-eol-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
