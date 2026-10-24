/**
 * Local durable idempotency demonstration for independent agents.
 * Each distinct economic purchase MUST have a stable application-provided intentId.
 * Fail closed if same intentId is seen again, even with a new seller invoice.
 * No secrets or signed transaction blobs are stored.
 * Not a multi-host distributed lock, Cloudflare database, or account-wide budget.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const HASH = /^[0-9A-Fa-f]{64}$/;
function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
export function createLocalAttemptJournal(folder) {
  requireValue(typeof folder === 'string' && folder.length > 0, 'CPX_INVALID_JOURNAL_DIR');
  const dir = resolve(folder);
  const fileFor = intentId => {
    requireValue(typeof intentId === 'string' && intentId.length >= 12 && intentId.length <= 200, 'CPX_BAD_INTENT_ID');
    return join(dir, createHash('sha256').update(intentId).digest('hex') + '.json');
  };
  async function load(intentId) {
    const raw = await readFile(fileFor(intentId), 'utf8');
    const state = JSON.parse(raw);
    requireValue(state.intentId === intentId, 'CPX_JOURNAL_ID_MISMATCH');
    return state;
  }
  async function reserve({intentId, payer, seller, resource, asset, amount}) {
    requireValue([payer,seller,resource,asset,amount].every(v => typeof v === 'string' && v.length > 0), 'CPX_BAD_INTENT');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = fileFor(intentId);
    // Open with O_EXCL: only one process can claim an intent at a time on local filesystem.
    let fd;
    try {
      fd = await open(file, 'wx', 0o600);
    } catch (err) {
      if (err?.code === 'EEXIST') throw new Error('CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED');
      throw err;
    }
    const state = {intentId, payer, seller, resource, asset, amount,
      status:'RESERVED_OUTCOME_UNKNOWN', createdAt:new Date().toISOString()};
    try {
      await fd.writeFile(JSON.stringify(state, null, 2));
      await fd.sync();
    } finally { await fd.close(); }
    return state;
  }
  async function signed(intentId, hash, expected) {
    requireValue(typeof hash === 'string' && HASH.test(hash), 'CPX_INVALID_SIGNED_HASH');
    const state = await load(intentId);
    requireValue(state.status === 'RESERVED_OUTCOME_UNKNOWN', 'CPX_SIGNED_STATE_CONFLICT');
    if (expected !== undefined) {
      requireValue(expected && typeof expected === 'object' && !Array.isArray(expected) &&
        expected.transactionHash === hash.toUpperCase() &&
        expected.payer === state.payer && expected.recipient === state.seller &&
        expected.asset === state.asset && expected.amount === state.amount,
        'CPX_EXPECTED_PAYMENT_MISMATCH');
    }
    return update(intentId, {...state, status:'SIGNED_SUBMISSION_UNKNOWN',
      transactionHash:hash.toUpperCase(), ...(expected === undefined ? {} : {expected})});
  }
  async function validated(intentId, verifiedReceipt) {
    const state = await load(intentId);
    requireValue(state.status === 'SIGNED_SUBMISSION_UNKNOWN' &&
      verifiedReceipt?.status === 'VALIDATED_SUCCESS' &&
      verifiedReceipt.transactionHash === state.transactionHash,
      'CPX_LEDGER_PROOF_REQUIRED');
    return update(intentId, {...state, status:'VALIDATED_SUCCESS',
      ledgerIndex:verifiedReceipt.ledgerIndex, verifiedReceipt, verifiedAt:new Date().toISOString()});
  }
  async function update(intentId, state) {
    const dest = fileFor(intentId);
    const temp = dest + '.' + randomUUID() + '.tmp';
    const fd = await open(temp, 'wx', 0o600);
    try { await fd.writeFile(JSON.stringify(state, null, 2)); await fd.sync(); }
    finally { await fd.close(); }
    await rename(temp, dest);
    return state;
  }
  return { reserve, signed, validated, load };
}
