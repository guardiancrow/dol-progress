import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readReleaseInputs, validateReleaseInputs, sha256 } from '../release-input-audit.mjs';

// Negative inputs are changed in memory only; committed approval targets stay fixed.
const original = readReleaseInputs(fileURLToPath(new URL('../../', import.meta.url)));
const prefix = 'release/notices/';
const approvalPath = prefix + 'v0.4.0-approval.json', reviewedPath = prefix + 'v0.4.0-reviewed.json';
const read = (m, p) => JSON.parse(m.files.get(p));
function edit(m, p, action) { const value = read(m, p); action(value); m.files.set(p, Buffer.from(JSON.stringify(value, null, 2) + '\n')); }
function rebind(m) {
  if (!m.files.has(approvalPath) || !m.files.has(reviewedPath)) return;
  const approvalHash = sha256(m.files.get(approvalPath));
  edit(m, reviewedPath, x => { x.final_review.evidence.sha256 = approvalHash; });
  const reviewedHash = sha256(m.files.get(reviewedPath));
  edit(m, prefix + 'source.json', x => {
    if (x.owner_approval) x.owner_approval.sha256 = approvalHash;
    x.source_updates[0].evidence.sha256 = reviewedHash;
  });
  edit(m, prefix + 'review.json', x => {
    if (x.owner_approval) x.owner_approval.sha256 = approvalHash;
    for (const e of x.release_refresh.evidence) {
      if (e.path === approvalPath) e.sha256 = approvalHash;
      if (e.path === reviewedPath) e.sha256 = reviewedHash;
    }
  });
  edit(m, prefix + 'manifest.json', x => {
    if (x.owner_approval) x.owner_approval.sha256 = approvalHash;
    for (const name of ['review', 'source']) x[name + '_sha256'] = sha256(m.files.get(prefix + name + '.json'));
  });
}
function rejects(name, mutate, gate, rehash = true) {
  test(name, () => { const m = { ...original, files: new Map(original.files) }; mutate(m); if (rehash) rebind(m); assert.throws(() => validateReleaseInputs(m), e => e.gate === gate); });
}
test('Reviewed inputs bind the real approval to committed PREPARED bytes', () => {
  const result = validateReleaseInputs(original);
  assert.equal(result.status, 'REVIEWED'); assert.equal(result.formal_approval, true);
  assert.equal(result.public_release_approved, false);
  assert.equal(result.content_commit, '7207214efcc64ed7db991d3777f0caab547fd1d8');
  assert.equal(result.original_texts, 149); assert.equal(result.references, 358);
});
rejects('Missing Owner approval is rejected', m => m.files.delete(approvalPath), 'input_missing');
rejects('REVIEWED labels without approval binding are rejected', m => edit(m, prefix + 'manifest.json', x => { delete x.owner_approval; }), 'approved_manifest_contract');
rejects('Unknown approval author is rejected after rehash', m => edit(m, approvalPath, x => { x.approved_by = 'invented'; }), 'owner_approval_evidence');
rejects('Wrong approval date is rejected after rehash', m => edit(m, approvalPath, x => { x.approved_on = '2026-11-09'; }), 'owner_approval_evidence');
rejects('A different approved snapshot cannot be substituted', m => edit(m, approvalPath, x => { x.prepared_snapshot.commit = 'a'.repeat(40); }), 'owner_approval_evidence');
rejects('Invented content commit in approval is rejected', m => edit(m, approvalPath, x => { x.canonical_content_commit = 'a'.repeat(40); }), 'owner_approval_evidence');
rejects('Self-consistent hashes cannot retarget Owner approval', m => edit(m, approvalPath, x => { x.prepared_snapshot.inputs['THIRD-PARTY-NOTICES.txt'] = 'a'.repeat(64); }), 'owner_approval_evidence');
rejects('Approval scope cannot include binary publication', m => edit(m, approvalPath, x => { x.public_release_approved = true; }), 'owner_approval_evidence');
rejects('Microsoft clearance cannot be inferred from approval', m => edit(m, approvalPath, x => { x.legal_clearance = true; }), 'owner_approval_evidence');
rejects('Missing final approval flag is rejected', m => edit(m, reviewedPath, x => { x.final_review.approved = false; }), 'reviewed_evidence');
rejects('New evidence cannot claim a future current commit', m => edit(m, reviewedPath, x => { x.canonical_notice.content_commit = 'b'.repeat(40); }), 'reviewed_evidence');
rejects('Saved PREPARED evidence remains immutable', m => edit(m, prefix + 'v0.4.0-refresh.json', x => { x.state = 'REVIEWED'; }), 'approved_bytes_unchanged');
rejects('Toolchain cannot change after approval', m => edit(m, reviewedPath, x => { x.candidate_toolchain.node = 'v0.0.0'; }), 'reviewed_evidence');
rejects('Invented source content commit is rejected', m => edit(m, prefix + 'source.json', x => { x.source_updates[0].content_commit = 'c'.repeat(40); }), 'approved_source_contract');
rejects('Original source provenance cannot be overwritten', m => edit(m, prefix + 'source.json', x => { x.source_commit = 'c'.repeat(40); }), 'approved_source_contract');
rejects('Old reviewer timestamp remains unchanged', m => edit(m, prefix + 'review.json', x => { x.reviewed_at = '2026-11-08'; }), 'approved_review_contract');
rejects('Coverage outside the approved transition is rejected', m => edit(m, prefix + 'review.json', x => { x.coverage[0].selected_license = 'changed'; }), 'approved_review_contract');
rejects('Coverage cannot remain PREPARED after transition', m => edit(m, prefix + 'review.json', x => { x.coverage.find(r => r.id === 'N201').review_state = 'PREPARED'; }), 'approved_review_contract');
rejects('Exclusion reason cannot revert to CSP null', m => edit(m, prefix + 'review.json', x => { const r = x.coverage.find(r => r.id.startsWith('excluded:cssparser@')); r.exclusion_reason = r.historical_exclusion_reason; }), 'approved_review_contract');
rejects('Unapproved inventory edit is rejected', m => edit(m, prefix + 'inventory.json', x => { x.components[0].version = '0.0.0'; }), 'approved_bytes_unchanged');
rejects('Approved canonical bytes cannot change', m => m.files.set('THIRD-PARTY-NOTICES.txt', Buffer.from('changed')), 'approved_bytes_unchanged');
rejects('N201 original cannot change', m => { const p = prefix + 'texts/5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27.txt'; m.files.set(p, Buffer.from('changed')); }, 'approved_bytes_unchanged');
rejects('Wrong manifest hash is rejected', m => edit(m, prefix + 'manifest.json', x => { x.review_sha256 = 'f'.repeat(64); }), 'approved_manifest_contract', false);
rejects('PREPARED status cannot pass the formal review audit', m => edit(m, prefix + 'manifest.json', x => { x.status = 'PREPARED'; }), 'reviewed_required');
