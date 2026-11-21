// Reconstruct and check the v0.6.0 PREPARED candidate. The CLI is read-only.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256 } from '../release-input-audit.mjs';
import { approvedNoticeDecisions } from '../notice-approval-decisions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = '0.6.0';
const target = 'x86_64-pc-windows-msvc';
const prefix = 'release/notices/v0.6.0/';
const legacy = 'release/notices/v0.5.0/';
const noticeName = 'THIRD-PARTY-NOTICES.txt';
const baseHead = 'aefee8711628dda824590d4448ddf0103cde6906';
const publishedHead = 'c63d60f01303f7057176b4f99be5e9e1d1aa9dda';
const counts = { included: 201, excluded: 6, original_texts: 149, references: 358 };
const toolingPaths = ['scripts/notice-candidates/.gitattributes', 'scripts/notice-candidates/v0.6.0.mjs'];
const versionPatterns = new Map([
  ['package.json', [/^(  "version": ")0\.5\.0(",)$/gm, 1]],
  ['package-lock.json', [/^( {2,6}"version": ")0\.5\.0(",)(?=\n(?:  "lockfileVersion"|      "license"))/gm, 2]],
  ['src-tauri/Cargo.toml', [/^(version = ")0\.5\.0(")$/gm, 1]],
  ['src-tauri/Cargo.lock', [/^(name = "dol-progress-manager"\nversion = ")0\.5\.0(")$/gm, 1]],
  ['src-tauri/tauri.conf.json', [/^(  "version": ")0\.5\.0(",)$/gm, 1]],
]);

function check(condition, gate) {
  if (!condition) throw new Error(gate);
}

const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const lf = bytes => bytes.toString('utf8').replaceAll('\r\n', '\n');

function readFile(relative) {
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    check(!lstatSync(file).isSymbolicLink(), 'candidate_reparse');
  }
  check(lstatSync(file).isFile(), 'candidate_not_file');
  return readFileSync(file);
}

function git(...args) {
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const blob = (commit, name) => git('show', `${commit}:${name}`);

function versionInputs(read) {
  const inputs = new Map();
  for (const [name, [pattern, count]] of versionPatterns) {
    const old = blob(publishedHead, name).toString('utf8');
    check([...old.matchAll(pattern)].length === count, 'published_app_version');
    const expected = Buffer.from(old.replace(pattern, (_, leading, trailing) => leading + version + trailing));
    const actual = read(name);
    check(expected.equals(actual) && actual.equals(blob(baseHead, name)), `application_version_bytes: ${name}`);
    inputs.set(name, actual);
  }
  return inputs;
}

function checkCoverage(inventory, review, oldNotice, read) {
  const records = new Map(review.coverage.map(record => [record.id, record]));
  const evidence = new Set();
  const originals = new Map();
  const noticeText = lf(oldNotice);
  let references = 0;
  check(records.size === 207 && review.coverage.length === 207 && inventory.components.length === 207, 'inherited_coverage_count');
  const ids = new Set();
  for (const component of inventory.components) {
    const record = records.get(component.id);
    check(!ids.has(component.id) && record?.included === component.included && record.evidence.length > 0
      && record.obligations_completed && record.provenance_completed, 'inherited_coverage_record');
    ids.add(component.id);
    for (const file of record.evidence) evidence.add(file);
    if (!component.included) {
      check(record.exclusion_reason?.length > 0, 'inherited_exclusion_reason');
      continue;
    }
    check(record.required_texts.length > 0 && record.copyrights.every(value => noticeText.includes(value)), 'inherited_notices');
    for (const entry of record.required_texts) {
      check(/^release\/notices\/texts\/[a-zA-Z0-9._-]+\.txt$/.test(entry.path) && record.evidence.includes(entry.path), 'inherited_original_path');
      if (!originals.has(entry.path)) {
        const bytes = read(entry.path);
        check(sha256(bytes) === entry.sha256 && noticeText.includes(lf(bytes)), 'inherited_original_bytes');
        originals.set(entry.path, entry.sha256);
      }
      check(originals.get(entry.path) === entry.sha256, 'inherited_original_hash');
      references++;
    }
    for (const entry of record.copyright_review?.source_evidence ?? []) {
      check(/^release\/notices\/(texts|evidence)\/[a-zA-Z0-9._-]+\.txt$/.test(entry.path)
        && record.evidence.includes(entry.path) && sha256(read(entry.path)) === entry.sha256, 'inherited_copyright_evidence');
    }
  }
  check(inventory.components.filter(component => component.included).length === counts.included
    && originals.size === counts.original_texts && references === counts.references, 'inherited_notice_counts');
  return [...evidence].sort();
}

function inheritedInputs(read) {
  const manifest = parse(blob(publishedHead, legacy + 'manifest.json'));
  const pin = approvedNoticeDecisions['0.5.0'];
  const proof = new Map();
  const fixed = [noticeName, ...['manifest.json', 'inventory.json', 'review.json', 'source.json',
    'preparation.json', 'approval.json', 'verification-preparation.json'].map(name => legacy + name)];
  for (const name of fixed) {
    const bytes = blob(publishedHead, name);
    check(bytes.equals(read(name)), `published_input_changed: ${name}`);
    proof.set(name, sha256(bytes));
  }
  check(manifest.status === 'REVIEWED' && manifest.version === '0.5.0'
    && manifest.owner_approval.path === pin.approval_path && proof.get(pin.approval_path) === pin.approval_sha256
    && manifest.owner_approval.sha256 === pin.approval_sha256 && manifest.approved_candidate.commit === pin.candidate_commit
    && manifest.approved_candidate.path === pin.snapshot_path && proof.get(pin.snapshot_path) === pin.snapshot_sha256
    && manifest.approved_candidate.sha256 === pin.snapshot_sha256, 'published_approval_binding');
  for (const name of ['inventory', 'review', 'source']) {
    check(manifest[`${name}_sha256`] === proof.get(`${legacy}${name}.json`), 'published_manifest_hash');
  }
  const oldNotice = read(noticeName);
  check(manifest.notices_sha256 === proof.get(noticeName), 'published_notice_hash');
  const inventory = parse(read(legacy + 'inventory.json'));
  const review = parse(read(legacy + 'review.json'));
  check(inventory.version === '0.5.0' && inventory.target === target && review.version === '0.5.0'
    && review.status === 'REVIEWED', 'published_metadata_identity');
  const evidence = checkCoverage(inventory, review, oldNotice, read);
  // Compare tracked evidence against the published commit. Git handles checkout EOL for the icon source.
  check(git('diff', '--name-only', publishedHead, '--', ...evidence).length === 0, 'inherited_evidence_changed');

  const snapshot = parse(read(pin.snapshot_path));
  const toolchain = snapshot.candidate_toolchain;
  const order = ['rustc', 'cargo', 'node', 'npm', 'tauri_cli', 'powershell'];
  const fingerprint = sha256(Buffer.from(order.map(key => `${key}=${[toolchain[key]].flat().join('\n')}`).join('\n') + '\n'));
  check(fingerprint === snapshot.candidate_toolchain_sha256 && fingerprint === manifest.toolchain_sha256
    && fingerprint === pin.toolchain_sha256, 'inherited_toolchain_fingerprint');
  return { manifest, pin, oldNotice, inventory, review, toolchain, fingerprint, proof };
}

export function prepareCandidate(read = readFile) {
  const versionFiles = versionInputs(read);
  const old = inheritedInputs(read);
  const oldHeader = Buffer.from('DOL Progress Manager 0.5.0 — THIRD-PARTY LICENSES AND NOTICES');
  const newHeader = Buffer.from('DOL Progress Manager 0.6.0 — THIRD-PARTY LICENSES AND NOTICES');
  check(old.oldNotice.subarray(0, oldHeader.length).equals(oldHeader), 'published_notice_header');
  const notice = Buffer.concat([newHeader, old.oldNotice.subarray(oldHeader.length)]);
  const noticesHash = sha256(notice);
  const lockHashes = {
    cargo_lock_sha256: sha256(versionFiles.get('src-tauri/Cargo.lock')),
    npm_lock_sha256: sha256(versionFiles.get('package-lock.json')),
  };
  const unresolved = ['Ownerによるv0.6.0候補入力の確認と明示承認'];
  const inheritance = {
    version: '0.5.0', release_commit: publishedHead, review_sha256: old.manifest.review_sha256,
    scope: 'Coverage and exclusions retain the historical v0.5.0 review. The v0.6.0 candidate awaits Owner approval.',
  };
  const inventory = { ...old.inventory, version };
  const review = { schema: 1, version, status: 'PREPARED', test_only: false, inheritance, coverage: old.review.coverage, unresolved };
  const source = {
    schema: 1, purpose: 'PACKAGE_NOTICE_SOURCE', version, target, canonical_file: prefix + noticeName, sha256: noticesHash,
    source_commit: baseHead, source_role: 'Release-0.6A application baseline. This is neither the candidate commit nor the final release HEAD.',
    previous_notice: { version: '0.5.0', release_commit: publishedHead, sha256: old.manifest.notices_sha256 },
    ...lockHashes, formal_review_state: 'PREPARED', formal_package_gate: 'PENDING_OWNER_APPROVAL',
  };
  const files = new Map([
    [prefix + noticeName, notice], [prefix + 'inventory.json', encode(inventory)],
    [prefix + 'review.json', encode(review)], [prefix + 'source.json', encode(source)],
  ]);
  const manifest = {
    schema: 1, version, status: 'PREPARED', scope: 'DISTRIBUTION', target, test_only: false, source_head: baseHead, unresolved,
    inventory_sha256: sha256(files.get(prefix + 'inventory.json')), review_sha256: sha256(files.get(prefix + 'review.json')),
    source_sha256: sha256(files.get(prefix + 'source.json')), notices_sha256: noticesHash,
    ...lockHashes, toolchain_sha256: old.fingerprint,
  };
  files.set(prefix + 'manifest.json', encode(manifest));
  const attributes = ['.gitattributes', prefix + '.gitattributes'];
  check(read('.gitattributes').equals(blob(publishedHead, '.gitattributes')), 'published_attributes_changed');
  const inputHashes = new Map([...versionFiles, ...attributes.map(name => [name, read(name)]), ...files]);
  const checks = Object.fromEntries([...inputHashes].map(([name, bytes]) => [name, sha256(bytes)]));
  files.set(prefix + 'preparation.json', encode({
    schema: 1, purpose: 'NOTICE_VERSION_REFRESH', version, target, state: 'PREPARED',
    release_scope_baseline: baseHead, inherited_release_commit: publishedHead,
    inheritance: { ...inheritance, ...counts, approved_candidate: old.pin.candidate_commit, inputs: Object.fromEntries(old.proof) },
    candidate_toolchain: old.toolchain, candidate_toolchain_sha256: old.fingerprint, toolchain_changes: {},
    changes: [
      'Six application version values; dependency definitions, versions and graph are unchanged.',
      'Version-specific Notices copied from the public v0.5.0 text with only the header version changed.',
      'Versioned PREPARED metadata with preserved historical coverage, exclusions and references.',
    ],
    final_review: { state: 'PENDING_OWNER_REVIEW', approved: false }, public_release_approved: false,
    approval_scope: ['v0.6.0 version values and exact candidate input bytes',
      'Inherited notice text, component coverage and exclusion reasons', 'Candidate toolchain fingerprint'],
    excluded_scope: ['New legal clearance', 'Verification implementation approval',
      'Formal Compile/Package/Verifier results', 'Final ZIP acceptance', 'Binary or GitHub Release publication'],
    candidate_input_sha256: checks,
    candidate_tooling_sha256: Object.fromEntries(toolingPaths.map(name => [name, sha256(read(name))])),
  }));
  return files;
}

export function validateCandidate(expected, read = readFile) {
  for (const [name, bytes] of expected) {
    const actual = read(name);
    if (name.endsWith('.json')) {
      const metadata = parse(actual);
      check(metadata.version === version, `candidate_version: ${name}`);
      if (name.endsWith('/manifest.json') || name.endsWith('/review.json')) check(metadata.status === 'PREPARED', 'candidate_must_be_prepared');
      if (name.endsWith('/source.json')) check(metadata.canonical_file === prefix + noticeName, 'candidate_canonical_path');
    }
    check(bytes.equals(actual), `candidate_bytes: ${name}`);
  }
  return {
    version, target, status: 'PREPARED', technical_validation: true, input_approval: false,
    verification_approval: false, formal_approval: false, public_release_approved: false, ...counts,
    notices_sha256: sha256(expected.get(prefix + noticeName)),
    preparation_sha256: sha256(expected.get(prefix + 'preparation.json')),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 0 || args.length === 2 && args[0] === '--version' && args[1] === version, 'unsupported_candidate_arguments');
    const expected = prepareCandidate();
    const names = new Set([...expected.keys()].map(name => path.basename(name)).concat('.gitattributes'));
    check(readdirSync(path.join(root, prefix)).every(name => names.has(name)), 'unexpected_candidate_file');
    const attr = git('check-attr', 'text', '--', prefix + noticeName).toString('utf8').trim();
    check(attr === `${prefix}${noticeName}: text: unset`, 'candidate_notice_git_attributes');
    console.log(JSON.stringify(validateCandidate(expected), null, 2));
  } catch (error) {
    console.error('PREPARED candidate audit failed: ' + error.message);
    process.exitCode = 1;
  }
}
