// Technical inspection only. Candidate validation never authorizes formal packaging.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { readReleaseInputs, validateReleaseInputs, sha256 } from './release-input-audit.mjs';

export const candidateVersion = '0.5.0';
export const candidatePrefix = 'release/notices/v0.5.0/';
export const baselineCommit = '41b6dc86affcbf1413ff6f13937490656afedb59';
export const releaseCommit = 'e14ba29c877805043c5f40ec103a3f733d5598e9';
export const versionPaths = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
const pending = ['Ownerによるv0.5.0候補入力・toolchain差分の確認と明示承認'];
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = bytes => JSON.parse(bytes.toString('utf8'));
function check(ok, gate) { if (!ok) { const e = new Error(gate); e.gate = gate; throw e; } }
const same = (a, b, gate) => check(isDeepStrictEqual(a, b), gate);
const gitBytes = (root, commit, name) => execFileSync('git', ['-C', root, 'show', commit + ':' + name], { maxBuffer: 16 * 1024 * 1024 });

export function versionBytes(name, original) {
  const text = original.toString('utf8').replaceAll('\r\n', '\n');
  let updated;
  if (name.endsWith('Cargo.lock')) {
    updated = text.replace(/(name = "dol-progress-manager"\nversion = ")0\.4\.0(")/, (_, before, after) => before + '0.5.0' + after);
  } else if (name.endsWith('Cargo.toml')) {
    updated = text.replace(/(\[package\][\s\S]*?\nversion = ")0\.4\.0(")/, (_, before, after) => before + '0.5.0' + after);
  } else {
    // Only the application version(s); dependency versions remain byte-for-byte intact.
    const count = name === 'package-lock.json' ? 2 : 1;
    let changed = 0;
    updated = text.replace(/"version": "0\.4\.0"/g, match => changed++ < count ? '"version": "0.5.0"' : match);
  }
  check(updated !== text, 'baseline_application_version');
  return Buffer.from(updated);
}

export function readCandidateModel(root) {
  const legacy = readReleaseInputs(root, { archived: true });
  validateReleaseInputs(legacy);
  const files = new Map();
  const names = [...versionPaths, 'THIRD-PARTY-NOTICES.txt', '.gitattributes',
    'scripts/release-input-audit.mjs', 'scripts/release-candidate-audit.mjs', 'scripts/portable-package-safety.ps1',
    'scripts/build-portable-package.ps1', 'scripts/verify-portable-package.ps1',
    ...['manifest.json', 'inventory.json', 'review.json', 'source.json', 'preparation.json'].map(p => candidatePrefix + p)];
  for (const name of names) files.set(name, fs.readFileSync(path.join(root, name)));
  const baseline = new Map(versionPaths.map(name => [name, gitBytes(root, baselineCommit, name)]));
  return { files, legacy, baseline };
}

// Deterministic candidate construction is also used by the in-memory negative tests.
// Inputs are derived from the unchanged v0.4.0 approval, not freshly invented review claims.
export function candidateMetadata({ files, legacy }) {
  const old = name => parse(legacy.files.get('release/notices/' + name));
  const previous = old('manifest.json');
  const toolchain = { ...old('v0.4.0-refresh.json').candidate_toolchain, node: 'v26.13.1', powershell: '5.1.26100.9818' };
  const fingerprint = ['rustc', 'cargo', 'node', 'npm', 'tauri_cli', 'powershell']
    .map(k => k + '=' + [toolchain[k]].flat().join('\n')).join('\n') + '\n';
  const toolchainHash = sha256(Buffer.from(fingerprint));
  const inventory = { ...old('inventory.json'), version: candidateVersion };
  const review = {
    schema: 1, version: candidateVersion, status: 'PREPARED', test_only: false,
    inheritance: { version: '0.4.0', release_commit: releaseCommit, review_sha256: previous.review_sha256,
      scope: 'Component review records below are inherited historical evidence, not v0.5.0 approval.' },
    coverage: old('review.json').coverage, unresolved: pending,
  };
  const source = {
    schema: 1, purpose: 'PACKAGE_NOTICE_SOURCE', version: candidateVersion, target: 'x86_64-pc-windows-msvc',
    canonical_file: 'THIRD-PARTY-NOTICES.txt', sha256: sha256(files.get('THIRD-PARTY-NOTICES.txt')),
    source_commit: baselineCommit, source_role: 'Release scope baseline; candidate content is not committed yet.',
    previous_notice: { version: '0.4.0', release_commit: releaseCommit, sha256: previous.notices_sha256 },
    cargo_lock_sha256: sha256(files.get('src-tauri/Cargo.lock')), npm_lock_sha256: sha256(files.get('package-lock.json')),
    formal_review_state: 'PREPARED', formal_package_gate: 'PENDING_OWNER_APPROVAL',
  };
  const result = new Map([['inventory.json', inventory], ['review.json', review], ['source.json', source]]
    .map(([name, value]) => [candidatePrefix + name, encode(value)]));
  const manifest = {
    schema: 1, version: candidateVersion, status: 'PREPARED', scope: 'DISTRIBUTION', test_only: false,
    source_head: baselineCommit, unresolved: pending,
    inventory_sha256: sha256(result.get(candidatePrefix + 'inventory.json')),
    review_sha256: sha256(result.get(candidatePrefix + 'review.json')),
    source_sha256: sha256(result.get(candidatePrefix + 'source.json')),
    notices_sha256: source.sha256, cargo_lock_sha256: source.cargo_lock_sha256,
    npm_lock_sha256: source.npm_lock_sha256, toolchain_sha256: toolchainHash,
  };
  result.set(candidatePrefix + 'manifest.json', encode(manifest));
  const bound = [...versionPaths, 'THIRD-PARTY-NOTICES.txt', '.gitattributes', 'scripts/release-input-audit.mjs',
    'scripts/release-candidate-audit.mjs', 'scripts/portable-package-safety.ps1',
    'scripts/build-portable-package.ps1', 'scripts/verify-portable-package.ps1', ...result.keys()];
  const preparation = {
    schema: 1, purpose: 'NOTICE_VERSION_REFRESH', version: candidateVersion, state: 'PREPARED',
    release_scope_baseline: baselineCommit, inherited_release_commit: releaseCommit,
    candidate_toolchain: toolchain, candidate_toolchain_sha256: toolchainHash,
    toolchain_changes: { node: ['v26.13.0', 'v26.13.1'], powershell: ['5.1.26100.9711', '5.1.26100.9818'] },
    final_review: { state: 'PENDING_OWNER_REVIEW', approved: false }, public_release_approved: false,
    approval_scope: ['Application version and exact current input bytes', 'Inherited notices and unchanged component coverage',
      'Node and Windows PowerShell fingerprint changes', 'Release input selection and validation changes'],
    excluded_scope: ['New legal clearance', 'Formal Compile/Package/Verifier results', 'Binary or GitHub Release publication'],
    candidate_input_sha256: Object.fromEntries(bound.map(p => [p, sha256(result.get(p) ?? files.get(p))])),
  };
  result.set(candidatePrefix + 'preparation.json', encode(preparation));
  return result;
}

export function validateCandidate(model) {
  validateReleaseInputs(model.legacy);
  for (const name of versionPaths) same(model.files.get(name), versionBytes(name, model.baseline.get(name)), 'application_version_bytes');
  const oldNotice = model.legacy.files.get('THIRD-PARTY-NOTICES.txt');
  const notice = Buffer.from(oldNotice.toString('utf8').replace('DOL Progress Manager 0.4.0 —', 'DOL Progress Manager 0.5.0 —'));
  check(!notice.equals(oldNotice), 'notice_version_header');
  same(model.files.get('THIRD-PARTY-NOTICES.txt'), notice, 'notice_inheritance_bytes');
  const expected = candidateMetadata(model);
  for (const [name, bytes] of expected) {
    check(model.files.has(name), 'candidate_input_missing');
    // Hashes certify actual distribution bytes; JSON is not EOL-normalized.
    same(model.files.get(name), bytes, 'candidate_contract');
  }
  return { version: candidateVersion, status: 'PREPARED', technical_validation: true, formal_approval: false,
    public_release_approved: false, included: 201, excluded: 6, original_texts: 149, references: 358 };
}

export const auditCandidate = root => validateCandidate(readCandidateModel(root));
