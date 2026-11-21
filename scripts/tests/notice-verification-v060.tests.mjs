import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectNoticeApprovalBinding, inspectV060VerificationPreparation, readRegisteredNoticeInput,
  verifyRegisteredNoticeApproval, v060ReviewedPaths } from '../notice-approval-binding.mjs';
import { approvedVerificationDecisions } from '../notice-approval-decisions.mjs';
import { sha256 } from '../release-input-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshotPath = 'release/notices/v0.6.0/verification-preparation.json';
const registryPath = 'scripts/notice-approval-decisions.mjs';
const read = name => fs.readFileSync(path.join(root, name));
const saved = read(snapshotPath);
const reviewedFiles = new Map(v060ReviewedPaths.map(name => [name, read(name)]));
const registryBytes = read(registryPath);
const { model, pin } = readRegisteredNoticeInput(root, '0.6.0');

// Test the read-only binding in memory. No Git commits or registry entries are created.
const decision = {
  version: '0.6.0', candidate_commit: pin.candidate_commit, snapshot_sha256: pin.snapshot_sha256,
  reviewed_commit: 'a'.repeat(40), implementation_snapshot_path: snapshotPath,
  implementation_snapshot_sha256: sha256(saved), approved_by: 'Owner', approved_on: null,
  approved_date_status: 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION', public_release_approved: false,
  reviewed_tooling_sha256: Object.fromEntries([...reviewedFiles].map(([name, bytes]) => [name, sha256(bytes)])),
};

test('prepared review snapshot matches the complete current implementation', () => {
  assert.doesNotThrow(() => inspectV060VerificationPreparation(pin, decision, saved, reviewedFiles, registryBytes));
  const snapshot = JSON.parse(saved);
  assert.equal(Object.hasOwn(snapshot, 'reviewed_commit'), false);
  assert.equal(Object.hasOwn(snapshot.file_sha256, registryPath), false);
  assert.equal(Object.hasOwn(snapshot.file_sha256, snapshotPath), false);
  assert.equal(Object.hasOwn(approvedVerificationDecisions, '0.6.0'), false);
  assert.throws(() => verifyRegisteredNoticeApproval(root, '0.6.0', pin.candidate_commit), { gate: 'implementation_review_pending' });
});

test('fixed review decision binds snapshot, reviewed bytes and registry evidence', () => {
  assert.throws(() => inspectV060VerificationPreparation(pin, decision, Buffer.from('{}'), reviewedFiles, registryBytes), { gate: 'implementation_snapshot_hash' });
  assert.throws(() => inspectV060VerificationPreparation(pin, { ...decision, reviewed_commit: pin.candidate_commit }, saved,
    reviewedFiles, registryBytes), { gate: 'implementation_snapshot_pin' });
  assert.throws(() => inspectV060VerificationPreparation({ ...pin, approval_sha256: '0'.repeat(64) }, decision, saved,
    reviewedFiles, registryBytes), { gate: 'implementation_snapshot_identity' });
  const altered = new Map(reviewedFiles);
  altered.set('scripts/release-input-audit.mjs', Buffer.from('changed'));
  assert.throws(() => inspectV060VerificationPreparation(pin, decision, saved, altered, registryBytes), { gate: 'implementation_reviewed_tooling_hash' });
  assert.throws(() => inspectV060VerificationPreparation(pin, decision, saved, reviewedFiles, Buffer.from('changed')), { gate: 'implementation_registry_hash' });
  assert.throws(() => inspectV060VerificationPreparation(pin, { ...decision, public_release_approved: true }, saved, reviewedFiles, registryBytes), { gate: 'implementation_decision' });
  const snapshot = JSON.parse(saved);
  snapshot.approved = true;
  const selfApproval = Buffer.from(JSON.stringify(snapshot));
  assert.throws(() => inspectV060VerificationPreparation(pin, { ...decision, implementation_snapshot_sha256: sha256(selfApproval) },
    selfApproval, reviewedFiles, registryBytes), { gate: 'implementation_snapshot_identity' });
});

test('implementation and source guards are independent of input approval', () => {
  const source = { head: 'b'.repeat(40), expectedHead: 'b'.repeat(40), signatureVerified: true, clean: true, candidateIsAncestor: true };
  const currentFiles = new Map([...model.currentFiles, ...reviewedFiles]);
  const combinedPin = { ...pin, reviewed_tooling_sha256: decision.reviewed_tooling_sha256 };
  const candidate = { ...model, currentFiles, source };
  const inspection = inspectNoticeApprovalBinding(candidate, combinedPin);
  assert.deepEqual(inspection, { binding_validated: true, version: '0.6.0', formal_approval: false, public_release_approved: false });
  for (const field of ['clean', 'signatureVerified', 'candidateIsAncestor']) {
    assert.throws(() => inspectNoticeApprovalBinding({ ...candidate, source: { ...source, [field]: false } }, combinedPin), { gate: 'source_guards' });
  }
  assert.throws(() => inspectNoticeApprovalBinding({ ...candidate, source: { ...source, expectedHead: pin.candidate_commit } }, combinedPin), { gate: 'source_identity' });
  const missingFiles = { ...combinedPin.reviewed_tooling_sha256 };
  delete missingFiles['scripts/notice-candidates/v0.6.0.mjs'];
  assert.throws(() => inspectNoticeApprovalBinding(candidate, { ...combinedPin, reviewed_tooling_sha256: missingFiles }), { gate: 'tooling_scope' });
  currentFiles.set('scripts/portable-package-safety.ps1', Buffer.from('different code'));
  assert.throws(() => inspectNoticeApprovalBinding(candidate, combinedPin), { gate: 'reviewed_tooling_hash' });
});
