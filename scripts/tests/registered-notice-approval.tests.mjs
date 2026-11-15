import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

// Real registration and verifier bytes, isolated Git history and a disposable test key.
// This never signs the working repository or certifies a Release artifact.
test('registered approval requires exact implementation bytes and a signed clean source', async t => {
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const parent = path.join(source, 'tmp');
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(parent, 'registered-notice-test-'));
  const root = path.join(scratch, 'source');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const run = (exe, args, cwd = root) => execFileSync(exe, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const git = (...args) => run('git', args);
  const keygen = process.platform === 'win32' ? path.join(process.env.WINDIR, 'System32/OpenSSH/ssh-keygen.exe') : 'ssh-keygen';
  const key = path.join(scratch, 'test-key');
  const registry = 'scripts/notice-approval-decisions.mjs';
  const audit = ['scripts/release-input-audit.mjs', '--version', '0.5.0', '--formal', '--expected-source-head'];
  const result = args => spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
  const rejected = (args, gate) => { const r = result(args); assert.notEqual(r.status, 0); assert.match(r.stderr, new RegExp(gate)); };
  const signedCommit = message => {
    git('add', '--all'); git('commit', '--quiet', '--allow-empty', '-S', '-m', 'TEST_ONLY ' + message);
    return git('rev-parse', 'HEAD').toString().trim();
  };
  try {
    run('git', ['clone', '--quiet', '--shared', '--no-checkout', source, root], source);
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.hooksPath', path.join(scratch, 'no-hooks'));
    const sourceHead = run('git', ['rev-parse', 'HEAD'], source).toString().trim();
    git('checkout', '--quiet', '--detach', sourceHead);
    // Overlay only tracked changes and this test, never ignored logs or user data.
    const changed = run('git', ['diff', '--name-only', 'HEAD'], source).toString().trim().split(/\r?\n/).filter(Boolean);
    for (const name of new Set([...changed, 'scripts/tests/registered-notice-approval.tests.mjs'])) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.copyFileSync(path.join(source, name), path.join(root, name));
    }
    run(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', 'TEST_ONLY', '-f', key], scratch);
    const existingSigners = run('git', ['config', '--path', '--get', 'gpg.ssh.allowedSignersFile'], source).toString().trim();
    const signerBytes = fs.readFileSync(path.resolve(source, existingSigners));
    const signers = path.join(scratch, 'allowed-signers');
    fs.writeFileSync(signers, Buffer.concat([signerBytes, Buffer.from('\ntest-only@example.invalid ' + fs.readFileSync(key + '.pub', 'utf8') + '\n')]));
    for (const [name, value] of Object.entries({
      'user.name': 'TEST_ONLY', 'user.email': 'test-only@example.invalid', 'gpg.format': 'ssh',
      'gpg.ssh.program': keygen, 'user.signingkey': key, 'gpg.ssh.allowedSignersFile': signers,
    })) git('config', name, value);
    const head = signedCommit('registered approval fixture');
    const registryBytes = fs.readFileSync(path.join(root, registry));
    await t.test('actual registration and Node reader pass, without public approval', () => {
      git('verify-commit', head);
      const r = JSON.parse(run(process.execPath, [...audit, head]));
      assert.equal(r.input_approval, true); assert.equal(r.verification_approval, true);
      assert.equal(r.formal_approval, true); assert.equal(r.public_release_approved, false);
    });
    if (process.platform === 'win32') await t.test('PowerShell notice reader returns approved canonical bytes', () => {
      const shell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
      const out = run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/tests/release-inputs.tests.ps1', '-ExpectedSourceHead', head]).toString();
      assert.match(out, /Registered input and code approval PASS/);
    });
    await t.test('missing or mismatched expected source is rejected', () => {
      rejected(audit.slice(0, -1), 'audit_arguments'); rejected([...audit, 'b'.repeat(40)], 'source_identity');
    });
    await t.test('untracked source is rejected', () => {
      const p = path.join(root, 'TEST_ONLY-untracked.txt'); fs.writeFileSync(p, 'TEST_ONLY\n');
      try { rejected([...audit, head], 'source_clean'); } finally { fs.unlinkSync(p); }
    });
    await t.test('dirty registered decisions are rejected', () => {
      fs.appendFileSync(path.join(root, registry), '// TEST_ONLY changed\n');
      try { rejected([...audit, head], 'source_clean'); } finally { fs.writeFileSync(path.join(root, registry), registryBytes); }
    });
    await t.test('modified snapshot cannot replace approved candidate', () => {
      const p = path.join(root, 'release/notices/v0.5.0/preparation.json'), bytes = fs.readFileSync(p);
      fs.appendFileSync(p, '\n');
      try { rejected([...audit, head], 'current_snapshot'); } finally { fs.writeFileSync(p, bytes); }
    });
    await t.test('unsigned source descendant is rejected', () => {
      fs.writeFileSync(path.join(root, 'TEST_ONLY-source.txt'), 'TEST_ONLY unsigned\n');
      git('add', '--all'); git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-gpg-sign', '-m', 'TEST_ONLY unsigned');
      rejected([...audit, git('rev-parse', 'HEAD').toString().trim()], 'source_signature_or_ancestry');
    });
    await t.test('untrusted signature is rejected', () => {
      const signed = signedCommit('signed source');
      fs.writeFileSync(signers, signerBytes);
      try { rejected([...audit, signed], 'source_signature_or_ancestry'); }
      finally { fs.appendFileSync(signers, '\ntest-only@example.invalid ' + fs.readFileSync(key + '.pub', 'utf8') + '\n'); }
    });
    await t.test('signed but changed implementation bytes are rejected', () => {
      fs.appendFileSync(path.join(root, 'scripts/build-portable-package.ps1'), '\n# TEST_ONLY tamper\n');
      rejected([...audit, signedCommit('changed implementation')], 'reviewed_tooling_hash');
    });
    await t.test('absence of code approval cannot be replaced by input approval', () => {
      const text = registryBytes.toString().replace(/export const approvedVerificationDecisions = [\s\S]*$/, 'export const approvedVerificationDecisions = Object.freeze({});\n');
      fs.writeFileSync(path.join(root, registry), text);
      rejected([...audit, signedCommit('absent code decision')], 'implementation_review_pending');
    });
    await t.test('another version is not authorized', () => {
      const r = result(['scripts/release-input-audit.mjs', '--version', '9.8.7', '--formal', '--expected-source-head', head]);
      assert.notEqual(r.status, 0); assert.match(r.stderr, /unsupported_release_version/);
    });
  } finally {
    const resolved = path.resolve(scratch);
    assert.equal(path.dirname(resolved), path.resolve(parent));
    assert.ok(path.basename(resolved).startsWith('registered-notice-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
