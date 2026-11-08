// Read-only notice inspection. This does not authorize or run a Release stage.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const prefix = 'release/notices/';
const refreshPath = prefix + 'v0.4.0-refresh.json';
const providerHash = '5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27';
const providerPath = prefix + 'texts/' + providerHash + '.txt';
const rustCommit = '58cf8f9c35b355199727627d07ae34a4e2846d67';
const checkpoint = '958722d87fb2405477530efc57553faec8d618c3';
const preparedCheckpoint = '7207214efcc64ed7db991d3777f0caab547fd1d8';
const approvalPath = prefix + 'v0.4.0-approval.json';
const reviewedPath = prefix + 'v0.4.0-reviewed.json';
const snapshotPaths = ['manifest.json', 'inventory.json', 'review.json', 'source.json', 'mapping.json', 'v0.4.0-preparation.json', 'v0.4.0-refresh.json'].map(x => prefix + x).concat(['THIRD-PARTY-NOTICES.txt', providerPath, 'docs/map-c12f-3-verification.md']);
const excluded = ['excluded:cssparser@0.37.0', 'excluded:cssparser-macros@0.7.1', 'excluded:selectors@0.38.0', 'excluded:dtoa-short@0.3.5'];
const runtimeIds = ['N196', 'N197', 'N198', 'N199', 'N200', 'N201'];
const currentReason = '現行Windows x64の通常target dependency経路なし。host build／proc-macroのHTML処理。CSPは非nullで、nullを除外条件にしていない。';
const pending = ['新原文・coverage・metadata・hash・限定検証結果に対するOwnerの最終確認'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function check(value, gate) { if (!value) { const error = new Error(gate); error.gate = gate; throw error; } }
function same(actual, expected, gate) { check(isDeepStrictEqual(actual, expected), gate); }
function safeRelative(name) { check(typeof name === 'string' && /^[a-zA-Z0-9._/-]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(s => s === '.' || s === '..'), 'relative_path'); return name; }
const parse = bytes => JSON.parse(bytes.toString('utf8'));

export function readReleaseInputs(root) {
  const files = new Map();
  const read = name => { safeRelative(name); if (!files.has(name)) files.set(name, fs.readFileSync(path.join(root, name))); return files.get(name); };
  check(parse(read(refreshPath)).input_checkpoint === checkpoint, 'review_checkpoint');
  const historical = {};
  for (const name of ['manifest.json', 'inventory.json', 'review.json', 'source.json', 'mapping.json', 'v0.4.0-preparation.json']) {
    historical[name] = execFileSync('git', ['-C', root, 'show', checkpoint + ':' + prefix + name]);
    read(prefix + name);
  }
  historical.notice = execFileSync('git', ['-C', root, 'show', checkpoint + ':THIRD-PARTY-NOTICES.txt'], { maxBuffer: 16 * 1024 * 1024 });
  for (const name of ['src-tauri/Cargo.lock', 'package-lock.json', 'THIRD-PARTY-NOTICES.txt', 'docs/map-c12f-2-notices-review.md']) read(name);
  for (const record of [...parse(read(prefix + 'review.json')).coverage, ...parse(historical['review.json']).coverage]) {
    for (const evidence of record.evidence) read(evidence);
    for (const text of record.required_texts ?? []) read(text.path);
  }
  read(approvalPath); read(reviewedPath);
  for (const name of snapshotPaths) read(name);
  const prepared = new Map(snapshotPaths.map(name => [name, execFileSync('git', ['-C', root, 'show', preparedCheckpoint + ':' + name], { maxBuffer: 16 * 1024 * 1024 })]));
  return { files, historical, prepared };
}

// Inspect the genuine archived PREPARED bytes, without relabeling current inputs.
export function preparedReleaseInputs(model) {
  const files = new Map(model.files);
  for (const [name, bytes] of model.prepared) files.set(name, bytes);
  return { files, historical: model.historical };
}

export function validatePreparedInputs({ files, historical }) {
  const get = name => { safeRelative(name); const bytes = files.get(name); check(Buffer.isBuffer(bytes), 'input_missing'); return bytes; };
  const json = name => parse(get(name));
  const matchHash = (name, hash) => check(/^[a-f0-9]{64}$/.test(hash) && sha256(get(name)) === hash, 'input_hash');
  const manifest = json(prefix + 'manifest.json'), review = json(prefix + 'review.json'), inventory = json(prefix + 'inventory.json'), source = json(prefix + 'source.json');
  const preparation = json(prefix + 'v0.4.0-preparation.json'), refresh = json(refreshPath);
  const oldReview = parse(historical['review.json']), oldInventory = parse(historical['inventory.json']), oldSource = parse(historical['source.json']);
  for (const input of [manifest, review, inventory, source, preparation, refresh]) check(input.version === '0.4.0', 'version');
  check(manifest.status === 'PREPARED' && review.status === 'PREPARED' && source.formal_review_state === 'PREPARED', 'final_review_pending');
  same(refresh.final_review, { state: 'PENDING_OWNER_REVIEW', approved: false }, 'final_approval_not_granted');
  check(refresh.state === 'PREPARED_FOR_FINAL_OWNER_REVIEW' && refresh.schema === 1 && refresh.purpose === 'NOTICE_RELEASE_REFRESH', 'refresh_state');
  check(refresh.approved_plan.state === 'OWNER_APPROVED_UPDATE_PLAN' && refresh.approved_plan.decision_by === 'Owner' && refresh.approved_plan.decision_date === '2026-11-08', 'plan_decision');
  for (const scope of ['最終REVIEWED昇格', 'Microsoft関連の既存未解決判断', 'バイナリ公開', 'GitHub Release公開']) check(refresh.approved_plan.excludes.includes(scope), 'approval_scope');
  check(refresh.legal_clearance === false && refresh.public_release_approved === false, 'publication_not_approved');
  same(manifest.unresolved, pending, 'pending_decision'); same(review.unresolved, pending, 'pending_decision');
  for (const [name, field] of [['inventory.json', 'inventory_sha256'], ['review.json', 'review_sha256'], ['source.json', 'source_sha256']]) matchHash(prefix + name, manifest[field]);
  matchHash('THIRD-PARTY-NOTICES.txt', manifest.notices_sha256); matchHash('THIRD-PARTY-NOTICES.txt', source.sha256);
  same(manifest, { ...parse(historical['manifest.json']), unresolved: pending, inventory_sha256: sha256(get(prefix + 'inventory.json')), review_sha256: sha256(get(prefix + 'review.json')), source_sha256: sha256(get(prefix + 'source.json')), notices_sha256: sha256(get('THIRD-PARTY-NOTICES.txt')) }, 'manifest_contract');
  same(source, { ...oldSource, sha256: sha256(get('THIRD-PARTY-NOTICES.txt')), source_updates: source.source_updates }, 'source_contract');
  same({ ...review, unresolved: oldReview.unresolved, coverage: oldReview.coverage, release_refresh: oldReview.release_refresh }, oldReview, 'review_contract');
  for (const item of [manifest, source]) { matchHash('src-tauri/Cargo.lock', item.cargo_lock_sha256); matchHash('package-lock.json', item.npm_lock_sha256); }
  same(get(prefix + 'mapping.json'), historical['mapping.json'], 'historical_mapping_bytes');
  same(get(prefix + 'v0.4.0-preparation.json'), historical['v0.4.0-preparation.json'], 'preparation_snapshot_bytes');
  matchHash(refresh.historical_mapping.path, refresh.historical_mapping.sha256);
  matchHash(refresh.preparation_snapshot.path, refresh.preparation_snapshot.sha256);
  matchHash(refresh.approved_plan.review_report, refresh.approved_plan.review_report_sha256);
  same(refresh.candidate_toolchain, preparation.candidate_toolchain, 'adopted_toolchain');
  const fingerprint = ['rustc', 'cargo', 'node', 'npm', 'tauri_cli', 'powershell'].map(k => k + '=' + [refresh.candidate_toolchain[k]].flat().join('\n')).join('\n') + '\n';
  check(sha256(Buffer.from(fingerprint)) === manifest.toolchain_sha256 && manifest.toolchain_sha256 === refresh.candidate_toolchain_sha256 && manifest.toolchain_sha256 === preparation.candidate_toolchain_sha256, 'toolchain_fingerprint');
  check(source.source_commit === oldSource.source_commit && manifest.source_head === parse(historical['manifest.json']).source_head, 'historical_provenance');
  for (const key of ['reviewer', 'reviewed_at', 'approval_basis', 'toolchain_refresh']) same(review[key], oldReview[key], 'historical_approval');
  const refreshEvidence = { path: refreshPath, sha256: sha256(get(refreshPath)) };
  for (const evidence of review.release_refresh.evidence) matchHash(evidence.path, evidence.sha256);
  same(review.release_refresh.evidence, [...oldReview.release_refresh.evidence, refreshEvidence], 'refresh_evidence');
  check(review.release_refresh.state === 'PREPARED_FOR_FINAL_OWNER_REVIEW' && review.release_refresh.preparation_scope === oldReview.release_refresh.scope, 'refresh_history');
  check(refresh.input_checkpoint === checkpoint, 'review_checkpoint');
  check(source.source_updates.length === 1 && source.source_updates[0].input_checkpoint === checkpoint && source.source_updates[0].upstream_rust_commit === rustCommit && source.source_updates[0].provider_sha256 === providerHash && source.source_updates[0].update_state === 'PREPARED', 'source_update_lineage');
  same(source.source_updates[0].evidence, refreshEvidence, 'source_update_evidence');
  check(source.source_updates[0].content_commit === null && refresh.canonical_notice.content_commit === null && source.source_updates[0].content_state === 'UNCOMMITTED_UPDATE' && refresh.canonical_notice.content_state === 'UNCOMMITTED_UPDATE', 'no_invented_content_commit');
  check(refresh.canonical_notice.previous_sha256 === sha256(historical.notice) && refresh.canonical_notice.sha256 === source.sha256 && refresh.inventory_sha256 === sha256(get(prefix + 'inventory.json')), 'candidate_snapshot');
  const expectedInventory = structuredClone(oldInventory);
  for (const item of expectedInventory.components) {
    if (['N196', 'N197', 'N198', 'N201'].includes(item.id)) item.version = item.version.replace('1.98.0', '1.99.1').replace('88d9e12ae178fab0fb5cc050a94da85685d449ea', rustCommit);
    if (item.id === 'N200') item.version = '0.1.28';
  }
  same(inventory, expectedInventory, 'inventory_limited_changes');
  const expectedCoverage = structuredClone(oldReview.coverage);
  for (const record of expectedCoverage) {
    if ([...runtimeIds, ...excluded].includes(record.id)) { record.evidence.push(refreshPath); record.review_state = 'PREPARED'; }
    if (record.id === 'N201') { record.required_texts.push({ path: providerPath, sha256: providerHash }); record.evidence.push(providerPath); }
    if (excluded.includes(record.id)) { record.historical_exclusion_reason = record.exclusion_reason; record.exclusion_reason = currentReason; }
  }
  same(review.coverage, expectedCoverage, 'coverage_limited_changes');
  same(refresh.current_record_mapping, inventory.components.filter(x => runtimeIds.includes(x.id)).map(x => ({ id: x.id, name: x.name, version: x.version, group: x.group, required_texts: review.coverage.find(r => r.id === x.id).required_texts })), 'current_mapping');
  same(refresh.exclusions.map(x => ({ id: x.id, included: x.included, previous_reason: x.previous_reason, current_reason: x.current_reason })), excluded.map(id => ({ id, included: false, previous_reason: oldReview.coverage.find(x => x.id === id).exclusion_reason, current_reason: currentReason })), 'exclusion_history');
  matchHash(providerPath, providerHash);
  check(get(providerPath).length === 1499465 && refresh.rust_source.provider_sha256 === providerHash && refresh.rust_source.provider_path === providerPath && refresh.rust_source.provider_bytes === get(providerPath).length && refresh.rust_source.commit === rustCommit && refresh.rust_source.library_lock_sha256 === '53d9ccff0c906de434b65af90d5c30063894b940fc839261f1fb06ef2e69e3d3', 'rust_provider');
  const notice = get('THIRD-PARTY-NOTICES.txt'), text = notice.toString('utf8');
  check(notice.length > 0 && notice.length <= 16777216 && !/\b(TEST_ONLY|SYNTHETIC|PLACEHOLDER|TODO|TBD|UNRESOLVED)\b|DRAFT\s+.\s+NOT FOR DISTRIBUTION|LICENSE CLEARANCE INCOMPLETE/i.test(text), 'canonical_notice_body');
  const uniqueTexts = new Set(); let references = 0;
  for (const record of review.coverage) {
    for (const evidence of record.evidence) get(evidence);
    for (const original of record.required_texts ?? []) {
      check(/^release\/notices\/texts\/[a-f0-9]{64}\.txt$/.test(original.path), 'original_path');
      matchHash(original.path, original.sha256); uniqueTexts.add(original.path); references++;
      check(text.replaceAll('\r\n', '\n').includes(get(original.path).toString('utf8').replaceAll('\r\n', '\n')), 'original_full_body');
    }
    for (const copyright of record.copyrights ?? []) check(text.includes(copyright), 'copyright_body');
  }
  check(uniqueTexts.size === 149 && references === 358 && review.coverage.length === 207 && inventory.components.filter(x => x.included).length === 201, 'current_coverage');
  same(refresh.current_coverage, { notice_records: 201, exclusions: 6, raw_texts: 149, text_references: 358 }, 'coverage_metadata');
  // Reverse only the approved header edits and appended original; preserve all old body bytes.
  const tail = '\n=== ORIGINAL TEXT ' + providerHash + ' ===\n' + get(providerPath).toString('utf8') + '\n=== END ORIGINAL TEXT ===\n';
  check(text.endsWith(tail), 'provider_append_bytes');
  let previousText = text.slice(0, -tail.length).replace('DOL Progress Manager 0.4.0 —', 'DOL Progress Manager 0.3.0 —');
  for (const id of ['N196', 'N197', 'N198', 'N200', 'N201']) {
    const old = oldInventory.components.find(x => x.id === id), current = inventory.components.find(x => x.id === id);
    previousText = previousText.replace('=== ' + current.name + ' / ' + current.version + ' ===', '=== ' + old.name + ' / ' + old.version + ' ===');
  }
  const oldProvider = oldReview.coverage.find(x => x.id === 'N201').required_texts[0].sha256;
  previousText = previousText.replace('原文参照 (SHA-256): ' + oldProvider + ', ' + providerHash + '\n旧Rust 1.98.0の提供元原文は歴史証拠として併記し、現行1.99.1の原文と区別します。\n', '原文参照 (SHA-256): ' + oldProvider + '\n');
  same(Buffer.from(previousText), historical.notice, 'old_canonical_bytes_preserved');
  return { version: '0.4.0', status: manifest.status, original_texts: uniqueTexts.size, references, notice_bytes: notice.length, notice_sha256: source.sha256, formal_approval: false };
}

export function validateReleaseInputs(model) {
  const { files, prepared } = model;
  const get = name => { safeRelative(name); const bytes = files.get(name); check(Buffer.isBuffer(bytes), 'input_missing'); return bytes; };
  const json = name => parse(get(name));
  const approval = json(approvalPath), reviewed = json(reviewedPath);
  const manifest = json(prefix + 'manifest.json'), review = json(prefix + 'review.json'), source = json(prefix + 'source.json');
  check(manifest.status === 'REVIEWED' && review.status === 'REVIEWED' && source.formal_review_state === 'REVIEWED', 'reviewed_required');
  const scope = ['v0.4.0への既存依存・通知・coverageの継承', '承認候補のToolchain採用', 'Rust N196-N200の適用更新', 'Rust N201の新しい提供元原文と旧証拠の保全', 'CSP関連4件の除外継承と現行理由', '正式Notices本文・metadata・参照hash・限定検証結果'];
  const approvedInputs = Object.fromEntries(snapshotPaths.map(name => [name, sha256(prepared.get(name))]));
  const previousRefresh = parse(prepared.get(refreshPath));
  same(approval, { schema: 1, purpose: 'NOTICE_OWNER_FINAL_APPROVAL', version: '0.4.0', state: 'APPROVED', approved_by: 'Owner', approved_on: '2026-11-08', basis: 'OWNER_EXPLICIT_APPROVAL_OF_MAP_C12F_3', instruction: 'Map-C12F-4 Owner承認記録とREVIEWED確定', scope, prepared_snapshot: { commit: preparedCheckpoint, inputs: approvedInputs }, canonical_content_commit: preparedCheckpoint, toolchain_sha256: previousRefresh.candidate_toolchain_sha256, coverage: previousRefresh.current_coverage, exclusions: ['Microsoft関連の契約適合判断・既存未解決事項の解消', 'バイナリ公開', 'GitHub Release公開'], legal_clearance: false, public_release_approved: false }, 'owner_approval_evidence');
  // Approval targets the committed candidate, not arbitrary freshly rehashed inputs.
  for (const name of [prefix + 'inventory.json', prefix + 'mapping.json', prefix + 'v0.4.0-preparation.json', refreshPath, 'THIRD-PARTY-NOTICES.txt', providerPath, 'docs/map-c12f-3-verification.md']) same(get(name), prepared.get(name), 'approved_bytes_unchanged');
  const approvalEvidence = { path: approvalPath, sha256: sha256(get(approvalPath)) };
  const expectedReviewed = structuredClone(previousRefresh);
  expectedReviewed.state = 'REVIEWED';
  expectedReviewed.prepared_snapshot = { commit: preparedCheckpoint, path: refreshPath, sha256: approvedInputs[refreshPath] };
  expectedReviewed.final_review = { state: 'APPROVED', approved: true, approved_by: 'Owner', approved_on: '2026-11-08', evidence: approvalEvidence };
  expectedReviewed.canonical_notice.content_commit = preparedCheckpoint;
  expectedReviewed.canonical_notice.content_state = 'COMMITTED';
  same(reviewed, expectedReviewed, 'reviewed_evidence');
  const reviewedEvidence = { path: reviewedPath, sha256: sha256(get(reviewedPath)) };
  const expectedSource = parse(prepared.get(prefix + 'source.json'));
  expectedSource.formal_review_state = 'REVIEWED'; expectedSource.owner_approval = approvalEvidence;
  const update = expectedSource.source_updates[0];
  update.update_state = 'REVIEWED'; update.content_commit = preparedCheckpoint; update.content_state = 'COMMITTED';
  update.prepared_evidence = update.evidence; update.evidence = reviewedEvidence;
  update.scope = 'source_commit preserves the original notice provenance. The updated canonical notice and new N201 original are stored in content_commit; approval metadata is a later change.';
  same(source, expectedSource, 'approved_source_contract');
  const expectedReview = parse(prepared.get(prefix + 'review.json'));
  expectedReview.status = 'REVIEWED'; expectedReview.unresolved = []; expectedReview.owner_approval = approvalEvidence;
  for (const record of expectedReview.coverage) if (record.review_state === 'PREPARED') { record.review_state = 'REVIEWED'; record.evidence.push(approvalPath); }
  expectedReview.release_refresh.state = 'REVIEWED';
  expectedReview.release_refresh.scope = 'Ownerは2026-11-08にMap-C12F-3の正式Notices本文・metadata・hash・限定検証結果を承認。Microsoft関連の法的残件とバイナリ公開は承認範囲外。';
  expectedReview.release_refresh.evidence.push(approvalEvidence, reviewedEvidence);
  same(review, expectedReview, 'approved_review_contract');
  const expectedManifest = parse(prepared.get(prefix + 'manifest.json'));
  expectedManifest.status = 'REVIEWED'; expectedManifest.unresolved = []; expectedManifest.owner_approval = approvalEvidence;
  expectedManifest.review_sha256 = sha256(get(prefix + 'review.json'));
  expectedManifest.source_sha256 = sha256(get(prefix + 'source.json'));
  same(manifest, expectedManifest, 'approved_manifest_contract');
  const inspected = validatePreparedInputs(preparedReleaseInputs(model));
  return { ...inspected, status: 'REVIEWED', formal_approval: true, public_release_approved: false, content_commit: preparedCheckpoint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(validateReleaseInputs(readReleaseInputs(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))))); }
  catch (error) { console.error('Release input audit failed: ' + (error.gate ?? 'input_read_or_parse')); process.exitCode = 1; }
}
