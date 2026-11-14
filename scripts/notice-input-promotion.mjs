// Limited input promotion. It never approves implementation code or runs packaging.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRegisteredNoticeInput, inspectNoticeInputApproval, reviewedNoticeMetadata } from './notice-approval-binding.mjs';

function check(value, gate) { if (!value) { const e = new Error(gate); e.gate = gate; throw e; } }
const names = version => ['manifest', 'review', 'source'].map(n => `release/notices/v${version}/${n}.json`);
function ordinaryFile(root, relative) {
  let current = path.resolve(root);
  check(!fs.lstatSync(current).isSymbolicLink(), 'promotion_reparse');
  for (const part of relative.split('/')) { current = path.join(current, part); check(!fs.lstatSync(current).isSymbolicLink(), 'promotion_reparse'); }
  check(fs.statSync(current).isFile(), 'promotion_not_file');
  return current;
}

// Filesystem transaction primitive, not an approval API. All preconditions are
// checked before writes; the caller supplies a validated deterministic plan.
export function applyMetadataTransaction(root, version, before, after) {
  check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'promotion_version');
  const allowed = names(version);
  check(before.size === 3 && after.size === 3 && allowed.every(n => before.has(n) && after.has(n)), 'promotion_scope');
  for (const n of allowed) {
    check(Buffer.isBuffer(before.get(n)) && Buffer.isBuffer(after.get(n)), 'promotion_bytes');
    check(fs.readFileSync(ordinaryFile(root, n)).equals(before.get(n)), 'promotion_precondition');
  }
  let temp = path.resolve(root);
  for (const part of ['tmp', 'notice-input-promotion']) {
    temp = path.join(temp, part);
    if (!fs.existsSync(temp)) fs.mkdirSync(temp);
    check(fs.lstatSync(temp).isDirectory() && !fs.lstatSync(temp).isSymbolicLink(), 'promotion_reparse');
  }
  const run = path.join(temp, randomUUID()); fs.mkdirSync(run);
  const changed = [];
  try {
    for (const [i, n] of allowed.entries()) {
      fs.writeFileSync(path.join(run, i + '.before'), before.get(n), { flag: 'wx' });
      fs.writeFileSync(path.join(run, i + '.after'), after.get(n), { flag: 'wx' });
    }
    for (const [i, n] of allowed.entries()) {
      const target = ordinaryFile(root, n);
      check(fs.readFileSync(target).equals(before.get(n)), 'promotion_concurrent_change');
      fs.renameSync(path.join(run, i + '.after'), target); changed.push([i, n]);
    }
  } catch (error) {
    let restored = true;
    for (const [i, n] of changed.reverse()) {
      try {
        const target = ordinaryFile(root, n);
        check(fs.readFileSync(target).equals(after.get(n)), 'promotion_rollback_conflict');
        fs.renameSync(path.join(run, i + '.before'), target);
      } catch { restored = false; }
    }
    check(restored, 'promotion_manual_recovery_required');
    check(false, error.gate ?? 'promotion_write_failed_rolled_back');
  }
  return { files_written: 3, formal_approval: false };
}

export function promoteNoticeInputs(root, version) {
  const { model, pin } = readRegisteredNoticeInput(root, version);
  const current = inspectNoticeInputApproval(model, pin);
  if (current.status === 'REVIEWED') return { ...current, files_written: 0 };
  const after = reviewedNoticeMetadata(model, pin);
  const before = new Map([...after.keys()].map(n => [n, model.currentFiles.get(n)]));
  applyMetadataTransaction(root, version, before, after);
  const next = readRegisteredNoticeInput(root, version);
  return { ...inspectNoticeInputApproval(next.model, next.pin), files_written: 3 };
}
