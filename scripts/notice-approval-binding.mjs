// Read-only preparation for future notice promotion. No metadata writer or CLI.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { approvedNoticeDecisions, approvedVerificationDecisions } from './notice-approval-decisions.mjs';
import { readCandidateModel, validateCandidate } from './release-candidate-audit.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function check(value, gate) { if (!value) { const e = new Error(gate); e.gate = gate; throw e; } }
function same(a, b, gate) { check(isDeepStrictEqual(a, b), gate); }
function json(bytes) { check(Buffer.isBuffer(bytes) && bytes.length <= 2 * 1024 * 1024, 'json_bytes'); return JSON.parse(bytes.toString('utf8')); }
function relative(name) {
  check(typeof name === 'string' && /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith('/')
    && !name.split('/').some(p => !p || p === '.' || p === '..'), 'relative_path');
  return name;
}
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function equalBytes(actual, expected, gate) { check(Buffer.isBuffer(actual) && actual.equals(expected), gate); }
function readMap(files, name) { relative(name); const b = files.get(name); check(Buffer.isBuffer(b), 'input_missing'); return b; }
const metadataNames = ['manifest.json', 'inventory.json', 'review.json', 'source.json'];
const verifierPath = 'scripts/notice-approval-binding.mjs';

function validatePin(pin, requireTooling = true) {
  check(pin && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pin.version), 'pin_version');
  check(isCommit(pin.candidate_commit) && isHash(pin.snapshot_sha256) && isHash(pin.approval_sha256), 'pin_hash');
  check(pin.snapshot_path === `release/notices/v${pin.version}/preparation.json`
    && pin.approval_path === `release/notices/v${pin.version}/approval.json`, 'pin_path');
  const dated = pin.approved_date_status === 'EXPLICIT_DATE' && typeof pin.approved_on === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(pin.approved_on) && Number.isFinite(Date.parse(pin.approved_on))
    && new Date(pin.approved_on).toISOString().slice(0, 10) === pin.approved_on;
  check(pin.approved_by === 'Owner' && (dated || pin.approved_on === null
    && pin.approved_date_status === 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION'), 'pin_decision');
  check(isHash(pin.toolchain_sha256), 'pin_toolchain');
  if (!requireTooling) return;
  check(pin.reviewed_tooling_sha256
    && Object.keys(pin.reviewed_tooling_sha256).length > 0, 'pin_tooling');
  for (const [name, hash] of Object.entries(pin.reviewed_tooling_sha256)) {
    relative(name); check((name === 'scripts/.gitattributes' || name.startsWith('scripts/') && /\.(?:mjs|ps1)$/.test(name)) && isHash(hash), 'pin_tooling');
  }
}

function toolchainHash(toolchain) {
  const names = ['rustc', 'cargo', 'node', 'npm', 'tauri_cli', 'powershell'];
  same(Object.keys(toolchain).sort(), [...names].sort(), 'toolchain_fields');
  for (const name of names) {
    const values = name === 'rustc' ? toolchain[name] : [toolchain[name]];
    check(Array.isArray(values) && values.length > 0 && values.every(v => typeof v === 'string' && v.length > 0 && !/[\r\n]/.test(v)), 'toolchain_value');
  }
  return sha256(Buffer.from(names.map(name => name + '=' + [toolchain[name]].flat().join('\n')).join('\n') + '\n'));
}

// Binding inspection is not an authorization API. The pin must come from a
// separately reviewed decision, not the approval file being inspected.
// Even a successful inspection reports formal_approval=false.
function validateInputDecision(model, pin) {
  validatePin(pin, false);
  check(model.version === pin.version && model.candidateCommit === pin.candidate_commit, 'candidate_identity');
  check(sha256(model.snapshotBytes) === pin.snapshot_sha256, 'snapshot_hash');
  const snapshot = json(model.snapshotBytes);
  check(snapshot.version === pin.version && snapshot.state === 'PREPARED'
    && snapshot.final_review?.approved === false && snapshot.public_release_approved === false, 'prepared_snapshot');
  check(snapshot.candidate_toolchain_sha256 === pin.toolchain_sha256
    && toolchainHash(snapshot.candidate_toolchain) === pin.toolchain_sha256, 'toolchain_fingerprint');
  const inputs = snapshot.candidate_input_sha256;
  check(inputs && Object.keys(inputs).length > 0, 'snapshot_inputs');
  same([...model.candidateFiles.keys()].sort(), Object.keys(inputs).sort(), 'candidate_file_set');
  for (const [name, hash] of Object.entries(inputs)) {
    check(isHash(hash) && sha256(readMap(model.candidateFiles, name)) === hash, 'candidate_input_hash');
  }
  check(sha256(model.approvalBytes) === pin.approval_sha256, 'approval_hash');
  const expectedApproval = {
    schema: 2, purpose: 'NOTICE_OWNER_INPUT_APPROVAL', version: pin.version, state: 'APPROVED',
    approved_by: pin.approved_by, approved_on: pin.approved_on, approved_date_status: pin.approved_date_status,
    basis: 'OWNER_EXPLICIT_FIXED_SNAPSHOT_APPROVAL',
    candidate_commit: pin.candidate_commit, snapshot_path: pin.snapshot_path, snapshot_sha256: pin.snapshot_sha256,
    scope: snapshot.approval_scope, excludes: [...snapshot.excluded_scope,
      'Unconditional approval of additional or changed verification code', 'Final ZIP acceptance'],
    toolchain_sha256: pin.toolchain_sha256, verification_review: 'SEPARATE_OWNER_REVIEW_REQUIRED',
    public_release_approved: false,
  };
  same(json(model.approvalBytes), expectedApproval, 'approval_decision');
  const prefix = `release/notices/v${pin.version}/`;
  const metadata = Object.fromEntries(metadataNames.map(n => [n, json(readMap(model.candidateFiles, prefix + n))]));
  check(metadata['manifest.json'].status === 'PREPARED' && metadata['review.json'].status === 'PREPARED'
    && metadata['source.json'].formal_review_state === 'PREPARED'
    && metadataNames.every(n => metadata[n].version === pin.version), 'candidate_metadata');
  return { snapshot, metadata, prefix };
}

// Pure deterministic transition. No approval is inferred and no file is written.
export function reviewedNoticeMetadata(model, pin) {
  const { metadata, prefix } = validateInputDecision(model, pin);
  const approval = { path: pin.approval_path, sha256: pin.approval_sha256 };
  const candidate = { commit: pin.candidate_commit, path: pin.snapshot_path, sha256: pin.snapshot_sha256 };
  const reviewed = new Map();
  // Only these declared metadata transitions are permitted. No coverage, license,
  // inventory, payload, runtime or toolchain inference is performed here.
  reviewed.set(prefix + 'review.json', encode({ ...metadata['review.json'], status: 'REVIEWED', unresolved: [], owner_approval: approval, approved_candidate: candidate }));
  reviewed.set(prefix + 'source.json', encode({ ...metadata['source.json'], formal_review_state: 'REVIEWED',
    formal_package_gate: 'PENDING_FORMAL_VERIFICATION', source_role: 'Release scope baseline; approved candidate is identified separately.',
    owner_approval: approval, approved_candidate: candidate }));
  reviewed.set(prefix + 'manifest.json', encode({ ...metadata['manifest.json'], status: 'REVIEWED', unresolved: [],
    owner_approval: approval, approved_candidate: candidate,
    review_sha256: sha256(reviewed.get(prefix + 'review.json')), source_sha256: sha256(reviewed.get(prefix + 'source.json')) }));
  return reviewed;
}

export function inspectNoticeInputApproval(model, pin) {
  const { snapshot } = validateInputDecision(model, pin);
  const reviewed = reviewedNoticeMetadata(model, pin);
  equalBytes(readMap(model.currentFiles, pin.snapshot_path), model.snapshotBytes, 'current_snapshot');
  equalBytes(readMap(model.currentFiles, pin.approval_path), model.approvalBytes, 'current_approval');
  let prepared = 0, promoted = 0;
  for (const [name, hash] of Object.entries(snapshot.candidate_input_sha256)) {
    if (name.startsWith('scripts/')) continue; // Reviewed separately; never grants formal approval.
    if (reviewed.has(name)) {
      const current = readMap(model.currentFiles, name);
      if (current.equals(readMap(model.candidateFiles, name))) prepared++;
      else if (current.equals(reviewed.get(name))) promoted++;
      else check(false, 'reviewed_transition');
    } else check(sha256(readMap(model.currentFiles, name)) === hash, 'current_input_hash');
  }
  check(prepared === 3 && promoted === 0 || prepared === 0 && promoted === 3, 'partial_transition');
  return { version: pin.version, status: promoted === 3 ? 'REVIEWED' : 'PREPARED', input_approval: true,
    verification_approval: false, formal_approval: false, public_release_approved: false };
}

export function inspectNoticeApprovalBinding(model, pin) {
  validatePin(pin);
  const { snapshot } = validateInputDecision(model, pin);
  const inputs = snapshot.candidate_input_sha256;
  const tooling = Object.keys(inputs).filter(p => p.startsWith('scripts/')).concat(verifierPath,
    'scripts/notice-input-promotion.mjs', 'scripts/.gitattributes');
  same(Object.keys(pin.reviewed_tooling_sha256).sort(), [...new Set(tooling)].sort(), 'tooling_scope');
  const reviewed = reviewedNoticeMetadata(model, pin);
  const expectedNames = [...Object.keys(inputs), pin.snapshot_path, pin.approval_path, ...Object.keys(pin.reviewed_tooling_sha256)];
  same([...model.currentFiles.keys()].sort(), [...new Set(expectedNames)].sort(), 'current_file_set');
  equalBytes(readMap(model.currentFiles, pin.snapshot_path), model.snapshotBytes, 'current_snapshot');
  equalBytes(readMap(model.currentFiles, pin.approval_path), model.approvalBytes, 'current_approval');
  for (const [name, hash] of Object.entries(inputs)) {
    if (reviewed.has(name)) equalBytes(readMap(model.currentFiles, name), reviewed.get(name), 'reviewed_transition');
    else if (!Object.hasOwn(pin.reviewed_tooling_sha256, name)) check(sha256(readMap(model.currentFiles, name)) === hash, 'current_input_hash');
  }
  for (const [name, hash] of Object.entries(pin.reviewed_tooling_sha256)) {
    check(sha256(readMap(model.currentFiles, name)) === hash, 'reviewed_tooling_hash');
  }
  const source = model.source;
  check(source && isCommit(source.head) && source.head === source.expectedHead && source.head !== pin.candidate_commit, 'source_identity');
  check(source.signatureVerified === true && source.clean === true && source.candidateIsAncestor === true, 'source_guards');
  return { binding_validated: true, version: pin.version, formal_approval: false, public_release_approved: false };
}

function readCurrentInput(root, name) {
  const parts = relative(name).split('/');
  let current = path.resolve(root);
  check(!fs.lstatSync(current).isSymbolicLink(), 'source_reparse');
  for (const part of parts) {
    current = path.join(current, part);
    check(!fs.lstatSync(current).isSymbolicLink(), 'source_reparse');
  }
  const stat = fs.statSync(current);
  check(stat.isFile() && stat.size <= 16 * 1024 * 1024, 'source_input_size');
  return fs.readFileSync(current);
}

export function readRegisteredNoticeInput(root, version) {
  const pin = Object.hasOwn(approvedNoticeDecisions, version) ? approvedNoticeDecisions[version] : undefined;
  check(pin, 'owner_approval_not_registered');
  validatePin(pin, false);
  const archived = readCandidateModel(root, { commit: pin.candidate_commit });
  validateCandidate(archived);
  const snapshotBytes = readMap(archived.files, pin.snapshot_path);
  const snapshot = json(snapshotBytes);
  const candidateFiles = new Map(Object.keys(snapshot.candidate_input_sha256).map(name => [name, readMap(archived.files, name)]));
  const names = [...candidateFiles.keys(), pin.snapshot_path, pin.approval_path];
  const currentFiles = new Map(names.map(name => [name, readCurrentInput(root, name)]));
  const model = { version, candidateCommit: pin.candidate_commit, snapshotBytes, candidateFiles,
    currentFiles, approvalBytes: currentFiles.get(pin.approval_path) };
  validateInputDecision(model, pin);
  return { model, pin };
}

export function inspectRegisteredNoticeInputs(root, version) {
  const { model, pin } = readRegisteredNoticeInput(root, version);
  return { ...inspectNoticeInputApproval(model, pin), verification_registered: Object.hasOwn(approvedVerificationDecisions, version) };
}

// Input approval alone cannot authorize implementation code or open the Package gate.
// Both registries are fixed code, never caller-supplied metadata.
export function verifyRegisteredNoticeApproval(root, version, expectedHead) {
  const { model, pin: inputPin } = readRegisteredNoticeInput(root, version);
  check(inspectNoticeInputApproval(model, inputPin).status === 'REVIEWED', 'inputs_not_promoted');
  const implementation = Object.hasOwn(approvedVerificationDecisions, version) ? approvedVerificationDecisions[version] : undefined;
  check(implementation, 'implementation_review_pending');
  check(implementation.version === version && implementation.candidate_commit === inputPin.candidate_commit
    && implementation.snapshot_sha256 === inputPin.snapshot_sha256, 'implementation_identity');
  const pin = { ...inputPin, reviewed_tooling_sha256: implementation.reviewed_tooling_sha256 };
  validatePin(pin);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const head = git('rev-parse', 'HEAD').toString('utf8').trim();
  check(isCommit(expectedHead) && head === expectedHead, 'source_identity');
  check(git('status', '--porcelain=v1', '--untracked-files=all').length === 0, 'source_clean');
  try { git('verify-commit', head); git('verify-commit', pin.candidate_commit); git('merge-base', '--is-ancestor', pin.candidate_commit, head); }
  catch { check(false, 'source_signature_or_ancestry'); }
  const names = [...model.currentFiles.keys(), ...Object.keys(pin.reviewed_tooling_sha256)];
  const currentFiles = new Map([...new Set(names)].map(name => [name, readCurrentInput(root, name)]));
  // Reject uncommitted/filter-altered inputs instead of normalizing their EOLs.
  for (const [name, bytes] of currentFiles) equalBytes(bytes, git('show', head + ':' + name), 'source_input_bytes');
  const inspected = inspectNoticeApprovalBinding({ ...model, currentFiles,
    source: { head, expectedHead, signatureVerified: true, clean: true, candidateIsAncestor: true } }, pin);
  return { ...inspected, status: 'REVIEWED', input_approval: true, verification_approval: true, formal_approval: true };
}
