/**
 * Private single-host cumulative XRPL spending capacity gate.
 * All reserved/uncertain/successful intents COUNT against caps indefinitely.
 * No automatic release after failure or timeout: refund/release needs a separate
 * carefully authenticated, ledger-grounded operator workflow (not shipped).
 * A wallet owner who can replace journalDir or edit storage can bypass these caps;
 * this is NOT an external enforcement boundary or multi-host coordination.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const RLUSD = ['524C555344000000000000000000000000000000', 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'];
const USDC = ['5553444300000000000000000000000000000000', 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'];
const CAP_KEYS = ['xrpDrops', 'rlusd', 'usdc'];
const DROPS = /^(?:0|[1-9][0-9]*)$/;
const TOKEN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,15})?$/;
const FACTOR = 10n ** 15n;
function check(ok, code) { if (!ok) throw new Error(code); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parseAmount(v, key) {
  check(typeof v === 'string' && v.length > 0 && v.length <= 64 &&
    (key === 'xrpDrops' ? DROPS : TOKEN).test(v), 'CPX_BUDGET_AMOUNT_INVALID');
  if (key === 'xrpDrops') return BigInt(v);
  const [whole, fract = ''] = v.split('.');
  return BigInt(whole) * FACTOR + BigInt(fract.padEnd(15, '0') || '0');
}
export function validateBudgetCaps(caps) {
  check(record(caps) && Object.keys(caps).length === 3 &&
    CAP_KEYS.every(k => Object.prototype.hasOwnProperty.call(caps,k)), 'CPX_BUDGET_CAPS_REQUIRED');
  for (const k of CAP_KEYS) check(parseAmount(caps[k], k) > 0n, 'CPX_BUDGET_CAP_MUST_BE_POSITIVE');
  return true;
}
function keyFor(asset, issuer) {
  if (asset === 'XRP' && issuer === undefined) return 'xrpDrops';
  if (asset === RLUSD[0] && issuer === RLUSD[1]) return 'rlusd';
  if (asset === USDC[0] && issuer === USDC[1]) return 'usdc';
  throw new Error('CPX_BUDGET_UNSUPPORTED_ASSET_OR_ISSUER');
}
async function syncDirectory(dir) {
  const fd = await open(dir, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function writeAtomic(dir, file, state) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(state, null, 2)); await fd.sync(); }
  finally { await fd.close(); }
  await rename(temp, file);
  await syncDirectory(dir);
}
export function createPersistentSpendingBudget(journalDir) {
  check(typeof journalDir === 'string' && journalDir.trim().length > 0, 'CPX_BUDGET_DIRECTORY_REQUIRED');
  const parent = resolve(journalDir);
  const dir = join(parent, '.cpx-spending-budget');
  const fileFor = payer => join(dir, createHash('sha256').update(payer).digest('hex') + '.json');

  async function ensurePrivateDir() {
    await mkdir(parent, {recursive: true, mode: 0o700});
    await mkdir(dir, {recursive: true, mode: 0o700});
    for (const folder of [parent, dir]) {
      const st = await lstat(folder);
      check(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0,
        'CPX_BUDGET_STORAGE_NOT_PRIVATE');
    }
  }
  async function reserve({intent, issuer, caps, maxFeeDrops, maxSendMax}) {
    validateBudgetCaps(caps);
    check(record(intent) && typeof intent.intentId === 'string' && intent.intentId.length >= 12 &&
      intent.intentId.length <= 200 && typeof intent.payer === 'string' && intent.payer.length > 0 &&
      typeof intent.asset === 'string', 'CPX_BUDGET_INVALID_INTENT');
    const key = keyFor(intent.asset, issuer);
    const deliveryUnits = parseAmount(intent.amount, key);
    check(deliveryUnits > 0n, 'CPX_BUDGET_AMOUNT_MUST_BE_POSITIVE');
    const feeUnits = parseAmount(maxFeeDrops, 'xrpDrops');
    check(feeUnits > 0n, 'CPX_BUDGET_FEE_REQUIRED');
    // Reserve the WORST-CASE issuer debit, not merely the delivered tokens.
    check((key === 'xrpDrops' && maxSendMax === undefined) ||
      (key !== 'xrpDrops' && typeof maxSendMax === 'string'), 'CPX_BUDGET_SENDMAX_REQUIRED');
    const units = key === 'xrpDrops' ? deliveryUnits : parseAmount(maxSendMax, key);
    check(units >= deliveryUnits, 'CPX_BUDGET_SENDMAX_BELOW_DELIVERY');
    check(units <= parseAmount(caps[key], key), 'CPX_CUMULATIVE_BUDGET_EXCEEDED');
    await ensurePrivateDir();
    const file = fileFor(intent.payer);
    const lock = file + '.lock';
    let lockFd;
    try { lockFd = await open(lock, 'wx', 0o600); }
    catch (err) {
      if (err?.code === 'EEXIST') throw new Error('CPX_BUDGET_LOCKED_FAIL_CLOSED');
      throw err;
    }
    // The exclusive lock is never automatically broken after a crash: fail closed.
    // Unlink only during normal cleanup after the state has been fsynced.
    try {
      await lockFd.writeFile(String(process.pid)); await lockFd.sync();
      const wantedCaps = Object.fromEntries(CAP_KEYS.map(k=>[k, parseAmount(caps[k], k).toString()]));
      let state;
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (err) {
        if (err?.code !== 'ENOENT') throw err;
        state = {version: 1, payer:intent.payer, caps:wantedCaps,
          reserved:{xrpDrops:'0',rlusd:'0',usdc:'0'}, intentIds:{}};
      }
      check(record(state) && state.version === 1 && state.payer === intent.payer &&
        record(state.caps) && record(state.reserved) && record(state.intentIds),
        'CPX_BUDGET_CORRUPT');
      for (const k of CAP_KEYS) {
        check(state.caps[k] === wantedCaps[k], 'CPX_BUDGET_CAP_CHANGE_FORBIDDEN');
        check(typeof state.reserved[k] === 'string' && DROPS.test(state.reserved[k]), 'CPX_BUDGET_CORRUPT');
        check(BigInt(state.reserved[k]) <= BigInt(state.caps[k]), 'CPX_BUDGET_CORRUPT');
      }
      const idHash = createHash('sha256').update(intent.intentId).digest('hex');
      check(!Object.prototype.hasOwnProperty.call(state.intentIds, idHash), 'CPX_BUDGET_DUPLICATE_INTENT');
      const next = BigInt(state.reserved[key]) + units;
      const newXrp = BigInt(state.reserved.xrpDrops) + feeUnits +
        (key === 'xrpDrops' ? units : 0n);
      check(next <= BigInt(state.caps[key]) && newXrp <= BigInt(state.caps.xrpDrops),
        'CPX_CUMULATIVE_BUDGET_EXCEEDED');
      state.reserved[key] = next.toString();
      state.reserved.xrpDrops = newXrp.toString();
      state.intentIds[idHash] = {asset:key, units:units.toString(), feeDrops:feeUnits.toString()};
      check(Buffer.byteLength(JSON.stringify(state)) <= 4 * 1024 * 1024, 'CPX_BUDGET_JOURNAL_TOO_LARGE');
      await writeAtomic(dir, file, state);
      return {status:'BUDGET_CAPACITY_RESERVED',asset:key,
        reserved:state.reserved[key], limit:state.caps[key], xrpReservedDrops:state.reserved.xrpDrops};
    } finally {
      await lockFd.close();
      await unlink(lock);
      await syncDirectory(dir);
    }
  }
  async function inspect(payer) {
    await ensurePrivateDir();
    return JSON.parse(await readFile(fileFor(payer), 'utf8'));
  }
  return {reserve, inspect};
}
