import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectNoticeApprovalBinding, inspectRegisteredNoticeInputs, inspectV060VerificationPreparation,
  readRegisteredNoticeInput, v060ReviewedPaths } from '../notice-approval-binding.mjs';
import { approvedVerificationDecisions } from '../notice-approval-decisions.mjs';
import { sha256 } from '../release-input-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshotPath = 'release/notices/v0.6.0/verification-preparation.json';
const registryPath = 'scripts/notice-approval-decisions.mjs';
const read = name => fs.readFileSync(path.join(root, name));
const git = (...args) => execFileSync('git', args, { cwd: root });
const decision = approvedVerificationDecisions['0.6.0'];
const readReviewed = name => git('cat-file', 'blob', `${decision.reviewed_commit}:${name}`);
const saved = read(snapshotPath);
const reviewedFiles = new Map(v060ReviewedPaths.map(name => [name, readReviewed(name)]));
const currentTooling = new Map(v060ReviewedPaths.map(name => [name, read(name)]));
const registryBytes = readReviewed(registryPath);
const { model, pin } = readRegisteredNoticeInput(root, '0.6.0');

test('registered verification matches the reviewed bytes and input approval alone is rejected', async () => {
  assert.equal(decision.reviewed_commit, 'a123a32d145a3334aab4cba6760de6619f2496ec');
  assert.equal(sha256(saved), '87428e03a4ccd5397a7374b2d92341ab2c47803c1b2e6518bfc6bafe6bba358a');
  assert.deepEqual(saved, readReviewed(snapshotPath));
  assert.deepEqual(currentTooling, reviewedFiles);
  inspectV060VerificationPreparation(pin, decision, saved, currentTooling, registryBytes);
  const snapshot = JSON.parse(saved);
  assert.equal(Object.hasOwn(snapshot, 'reviewed_commit'), false);
  assert.equal(Object.hasOwn(snapshot.file_sha256, registryPath), false);
  assert.equal(Object.hasOwn(snapshot.file_sha256, snapshotPath), false);
  const approvedInputs = {
    version: '0.6.0', status: 'REVIEWED', input_approval: true, verification_approval: false,
    formal_approval: false, public_release_approved: false,
  };
  assert.deepEqual(inspectRegisteredNoticeInputs(root, '0.6.0'), { ...approvedInputs, verification_registered: true });

  // Load a separate verifier instance with the real input pins and an empty code registry.
  const verifier = new URL('../notice-approval-binding.mjs?fixture=input-approval-only', import.meta.url).href;
  const registry = new URL('../notice-approval-decisions.mjs', import.meta.url).href;
  const inputOnly = 'data:text/javascript,' + encodeURIComponent(
    `export { approvedNoticeDecisions } from ${JSON.stringify(registry)};
export const approvedVerificationDecisions = Object.freeze({});`);
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === verifier && specifier === './notice-approval-decisions.mjs') {
        return { url: inputOnly, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const fixture = await import(verifier);
    assert.deepEqual(fixture.inspectRegisteredNoticeInputs(root, '0.6.0'), { ...approvedInputs, verification_registered: false });
    const head = git('rev-parse', 'HEAD').toString().trim();
    assert.throws(() => fixture.verifyRegisteredNoticeApproval(root, '0.6.0', head), { gate: 'implementation_review_pending' });
  } finally {
    hook.deregister();
  }
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
  assert.throws(() => inspectV060VerificationPreparation(pin, decision, saved, reviewedFiles, read(registryPath)), { gate: 'implementation_registry_hash' });
  assert.throws(() => inspectV060VerificationPreparation(pin, { ...decision, public_release_approved: true }, saved, reviewedFiles, registryBytes), { gate: 'implementation_decision' });
  const snapshot = JSON.parse(saved);
  snapshot.approved = true;
  const selfApproval = Buffer.from(JSON.stringify(snapshot));
  assert.throws(() => inspectV060VerificationPreparation(pin, { ...decision, implementation_snapshot_sha256: sha256(selfApproval) },
    selfApproval, reviewedFiles, registryBytes), { gate: 'implementation_snapshot_identity' });
});

test('implementation and source guards are independent of input approval', () => {
  const source = { head: 'b'.repeat(40), expectedHead: 'b'.repeat(40), signatureVerified: true, clean: true, candidateIsAncestor: true };
  const currentFiles = new Map([...model.currentFiles, ...currentTooling]);
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
