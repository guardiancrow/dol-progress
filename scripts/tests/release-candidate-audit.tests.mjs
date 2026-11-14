import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCandidateModel, validateCandidate, candidateMetadata, candidatePrefix, versionPaths } from '../release-candidate-audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const original = readCandidateModel(root);
const clone = () => ({ ...original, files: new Map(original.files) });
const edit = (m, p, action) => { const v = JSON.parse(m.files.get(p)); action(v); m.files.set(p, Buffer.from(JSON.stringify(v, null, 2) + '\n')); };
function rebind(m) { for (const [p, b] of candidateMetadata(m)) m.files.set(p, b); }
function rejects(name, change, gate, bind = false) {
  test(name, () => { const m = clone(); change(m); if (bind) rebind(m); assert.throws(() => validateCandidate(m), e => e.gate === gate); });
}
test('v0.5.0 technical candidate passes without approval', () => {
  const result = validateCandidate(original);
  assert.equal(result.status, 'PREPARED'); assert.equal(result.formal_approval, false);
  assert.equal(result.public_release_approved, false); assert.equal(result.original_texts, 149);
});
test('candidate CLI and formal CLI have different outcomes', () => {
  const run = args => spawnSync(process.execPath, ['scripts/release-input-audit.mjs', ...args], { cwd: root, encoding: 'utf8' });
  const candidate = run(['--version', '0.5.0', '--candidate']);
  assert.equal(candidate.status, 0, candidate.stderr);
  assert.equal(JSON.parse(candidate.stdout).formal_approval, false);
  for (const args of [[], ['--version', '0.5.0'], ['--candidate'], ['--version', '9.9.9']]) assert.notEqual(run(args).status, 0);
});
for (const p of versionPaths) {
  rejects(`application version or dependency mutation rejected: ${p}`, m => m.files.set(p, Buffer.concat([m.files.get(p), Buffer.from('\nchanged')])), 'application_version_bytes', true);
  rejects(`CRLF current bytes rejected: ${p}`, m => m.files.set(p, Buffer.from(m.files.get(p).toString().replaceAll('\n', '\r\n'))), 'application_version_bytes', true);
}
rejects('rehashed canonical notice mutation rejected', m => m.files.set('THIRD-PARTY-NOTICES.txt', Buffer.concat([m.files.get('THIRD-PARTY-NOTICES.txt'), Buffer.from('changed')])), 'notice_inheritance_bytes', true);
rejects('premature REVIEWED rejected', m => edit(m, candidatePrefix + 'manifest.json', x => { x.status = 'REVIEWED'; }), 'candidate_contract');
rejects('fabricated approval rejected', m => edit(m, candidatePrefix + 'preparation.json', x => { x.final_review.approved = true; }), 'candidate_contract');
rejects('publication approval cannot be inferred', m => edit(m, candidatePrefix + 'preparation.json', x => { x.public_release_approved = true; }), 'candidate_contract');
rejects('toolchain fingerprint mutation rejected', m => edit(m, candidatePrefix + 'preparation.json', x => { x.candidate_toolchain.node = 'v0.0.0'; }), 'candidate_contract');
rejects('coverage mutation rejected', m => edit(m, candidatePrefix + 'review.json', x => { x.coverage.pop(); }), 'candidate_contract');
rejects('metadata CRLF conversion rejected', m => { const p = candidatePrefix + 'source.json'; m.files.set(p, Buffer.from(m.files.get(p).toString().replaceAll('\n', '\r\n'))); }, 'candidate_contract');
rejects('missing candidate metadata rejected', m => m.files.delete(candidatePrefix + 'review.json'), 'candidate_input_missing');
test('historical reports are read from original blobs; current input bytes stay strict', () => {
  assert.equal(original.legacy.scope, 'ARCHIVED_V0_4_0');
  const p = 'docs/map-c12f-3-verification.md';
  const expected = execFileSync('git', ['show', '7207214efcc64ed7db991d3777f0caab547fd1d8:' + p], { cwd: root });
  assert.deepEqual(original.legacy.files.get(p), expected);
});
test('targeted EOL attributes reproduce identical input bytes with autocrlf true/false/input', () => {
  // Only a synthetic temporary repository. No user configuration or worktree is changed.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dol-eol-test-'));
  try {
    const git = args => execFileSync('git', ['-C', fixture, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '--quiet']);
    fs.writeFileSync(path.join(fixture, '.gitattributes'), fs.readFileSync(path.join(root, '.gitattributes')));
    const names = [...versionPaths, 'docs/map-c12f-2-notices-review.md', 'docs/map-c12f-3-verification.md',
      'scripts/release-input-audit.mjs', 'scripts/release-candidate-audit.mjs', 'scripts/portable-package-safety.ps1',
      'scripts/build-portable-package.ps1', 'scripts/verify-portable-package.ps1'];
    for (const p of names) { fs.mkdirSync(path.dirname(path.join(fixture, p)), { recursive: true }); fs.writeFileSync(path.join(fixture, p), 'TEST_ONLY\nsynthetic bytes\n'); }
    git(['add', '--', '.gitattributes', ...names]);
    for (const setting of ['true', 'false', 'input']) {
      // Delete only individually named synthetic fixture files to force a fresh checkout.
      for (const p of names) fs.unlinkSync(path.join(fixture, p));
      git(['-c', 'core.autocrlf=' + setting, 'checkout-index', '--all', '--force']);
      for (const p of names) assert.equal(fs.readFileSync(path.join(fixture, p), 'utf8'), 'TEST_ONLY\nsynthetic bytes\n');
    }
  } finally {
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dol-eol-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
