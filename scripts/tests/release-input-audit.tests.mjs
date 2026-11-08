import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readReleaseInputs, validateReleaseInputs, sha256 } from '../release-input-audit.mjs';

// Published notice inputs only. Mutations stay in memory; no approval or file write.
const original = readReleaseInputs(fileURLToPath(new URL('../../', import.meta.url)));
const prefix = 'release/notices/';
const refreshPath = prefix + 'v0.4.0-refresh.json';
const providerPath = prefix + 'texts/5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27.txt';
const variant = () => ({ files: new Map(original.files), historical: original.historical });
const read = (model, name) => JSON.parse(model.files.get(name));
function edit(model, name, action) { const value = read(model, name); action(value); model.files.set(name, Buffer.from(JSON.stringify(value, null, 2) + '\n')); }
function rebind(model) {
  // Rehash links so negative cases exercise semantic guards beyond hash mismatch.
  edit(model, prefix + 'source.json', value => { value.sha256 = sha256(model.files.get('THIRD-PARTY-NOTICES.txt')); value.source_updates[0].evidence.sha256 = sha256(model.files.get(refreshPath)); });
  edit(model, prefix + 'review.json', value => { value.release_refresh.evidence.at(-1).sha256 = sha256(model.files.get(refreshPath)); });
  edit(model, prefix + 'manifest.json', value => {
    for (const name of ['review', 'source', 'inventory']) value[name + '_sha256'] = sha256(model.files.get(prefix + name + '.json'));
    value.notices_sha256 = sha256(model.files.get('THIRD-PARTY-NOTICES.txt'));
  });
}
function rejects(name, mutation, gate) {
  test(name, () => { const model = variant(); mutation(model); rebind(model); assert.throws(() => validateReleaseInputs(model), error => error.gate === gate); });
}
test('Candidate passes while final approval remains false', () => {
  const result = validateReleaseInputs(original);
  assert.equal(result.status, 'PREPARED'); assert.equal(result.formal_approval, false);
  assert.equal(result.original_texts, 149); assert.equal(result.references, 358);
});
rejects('Unapproved record license change fails after rehash', m => edit(m, prefix + 'review.json', x => { x.coverage[0].selected_license = 'changed'; }), 'coverage_limited_changes');
rejects('Missing coverage record fails after rehash', m => edit(m, prefix + 'review.json', x => { x.coverage.pop(); }), 'coverage_limited_changes');
rejects('Old reviewer date cannot become a new approval date', m => edit(m, prefix + 'review.json', x => { x.reviewed_at = '2026-11-08'; }), 'review_contract');
rejects('Excluded parser cannot become included', m => edit(m, prefix + 'review.json', x => { x.coverage.find(r => r.id.startsWith('excluded:cssparser@')).included = true; }), 'coverage_limited_changes');
rejects('Stale CSP null reason is rejected', m => edit(m, prefix + 'review.json', x => { const r = x.coverage.find(r => r.id.startsWith('excluded:cssparser@')); r.exclusion_reason = r.historical_exclusion_reason; }), 'coverage_limited_changes');
rejects('Dropping historical provider reference is rejected', m => edit(m, prefix + 'review.json', x => { x.coverage.find(r => r.id === 'N201').required_texts.shift(); }), 'coverage_limited_changes');
rejects('New record cannot retain old REVIEWED claim', m => edit(m, prefix + 'review.json', x => { x.coverage.find(r => r.id === 'N201').review_state = 'REVIEWED'; }), 'coverage_limited_changes');
rejects('Premature manifest REVIEWED is rejected', m => edit(m, prefix + 'manifest.json', x => { x.status = 'REVIEWED'; }), 'final_review_pending');
rejects('Final approval cannot be inferred from plan approval', m => edit(m, refreshPath, x => { x.final_review.approved = true; }), 'final_approval_not_granted');
rejects('Binary publication cannot be enabled by refresh', m => edit(m, refreshPath, x => { x.public_release_approved = true; }), 'publication_not_approved');
rejects('Changed toolchain is rejected after rehash', m => edit(m, refreshPath, x => { x.candidate_toolchain.node = 'v0.0.0'; }), 'adopted_toolchain');
rejects('Original source commit cannot be relabeled', m => edit(m, prefix + 'source.json', x => { x.source_commit = 'a'.repeat(40); }), 'source_contract');
rejects('Uncommitted content must not claim a commit', m => edit(m, prefix + 'source.json', x => { x.source_updates[0].content_commit = 'a'.repeat(40); }), 'no_invented_content_commit');
rejects('Unrelated inventory edit is rejected after rehash', m => {
  edit(m, prefix + 'inventory.json', x => { x.components[0].version = '0.0.0'; });
  edit(m, refreshPath, x => { x.inventory_sha256 = sha256(m.files.get(prefix + 'inventory.json')); });
}, 'inventory_limited_changes');
rejects('Formal fixture flag cannot be introduced', m => edit(m, prefix + 'manifest.json', x => { x.test_only = true; }), 'manifest_contract');
rejects('Old original byte mutation is rejected', m => {
  const old = read(m, prefix + 'review.json').coverage[0].required_texts[0].path;
  m.files.set(old, Buffer.concat([m.files.get(old), Buffer.from('\nchanged')]));
}, 'input_hash');
rejects('New provider byte mutation is rejected', m => m.files.set(providerPath, Buffer.from('changed')), 'input_hash');
rejects('Hash-consistent notice change outside allowed headers is rejected', m => {
  const text = m.files.get('THIRD-PARTY-NOTICES.txt').toString().replace('本アプリ独自コード', 'changed');
  m.files.set('THIRD-PARTY-NOTICES.txt', Buffer.from(text));
  edit(m, refreshPath, x => { x.canonical_notice.sha256 = sha256(m.files.get('THIRD-PARTY-NOTICES.txt')); });
}, 'old_canonical_bytes_preserved');
rejects('Missing new original in canonical notice fails even after rehash', m => {
  const text = m.files.get('THIRD-PARTY-NOTICES.txt').toString();
  m.files.set('THIRD-PARTY-NOTICES.txt', Buffer.from(text.slice(0, text.lastIndexOf('\n=== ORIGINAL TEXT '))));
  edit(m, refreshPath, x => { x.canonical_notice.sha256 = sha256(m.files.get('THIRD-PARTY-NOTICES.txt')); });
}, 'original_full_body');
