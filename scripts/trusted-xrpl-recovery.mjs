/**
 * Read-only XRPL mainnet reconciliation for cpX x402 Pay.
 * The public path cannot inject a seller-controlled RPC, verifier or HTTP response.
 * The fixed public XRPL server is a trusted service dependency, not independent
 * cryptographic consensus verification. All uncertain outcomes remain blocked.
 */
import { createLocalAttemptJournal } from './local-attempt-journal.mjs';
import { verifyValidatedXrplSettlement } from '../dist/src/settlement_verifier.js';

export const XRPL_MAINNET_READ_ONLY_URL = 'wss://s1.ripple.com';
const HASH = /^[A-F0-9]{64}$/;
const valid = (v, code) => { if (!v) throw new Error(code); };

/** Internal test seam. Not exported by package root. */
export async function queryValidatedTransaction({hash, makeClient}) {
  valid(typeof hash === 'string' && HASH.test(hash), 'CPX_RECOVERY_INVALID_HASH');
  valid(typeof makeClient === 'function', 'CPX_RECOVERY_CLIENT_REQUIRED');
  const client = await makeClient(XRPL_MAINNET_READ_ONLY_URL);
  valid(client && typeof client.connect === 'function' && typeof client.request === 'function' &&
    typeof client.disconnect === 'function', 'CPX_RECOVERY_INVALID_CLIENT');
  try {
    await client.connect();
    // No submit, submitAndWait, sign, autofill, account_tx or seller endpoint.
    return await client.request({
      command:'tx', transaction:hash, binary:false, api_version:2
    });
  } finally {
    await client.disconnect();
  }
}

/** Private test seam, intentionally not a package export. */
export async function reconcileWithLedger({journal, intentId, makeClient}) {
  valid(journal && typeof journal.load === 'function' && typeof journal.validated === 'function',
    'CPX_RECOVERY_JOURNAL_REQUIRED');
  valid(typeof intentId === 'string' && intentId.length >= 12 && intentId.length <= 200,
    'CPX_RECOVERY_INTENT_REQUIRED');
  const state = await journal.load(intentId);
  valid(state.status === 'SIGNED_SUBMISSION_UNKNOWN' && state.expected &&
    state.transactionHash === state.expected.transactionHash && HASH.test(state.transactionHash),
    'CPX_RECOVERY_SIGNED_EXPECTATION_REQUIRED');
  // If tx isn't found, network errors, is unvalidated, or has mismatched fields,
  // DO NOT update the journal or permit a new payment.
  const txResult = await queryValidatedTransaction({hash:state.transactionHash, makeClient});
  const receipt = verifyValidatedXrplSettlement(txResult,state.expected);
  await journal.validated(intentId,receipt);
  return receipt;
}

/** Public supported entry point. No caller-provided lookup or verification functions. */
export async function reconcileSecureNodePurchase(options) {
  valid(options && typeof options === 'object' && !Array.isArray(options) &&
    Object.keys(options).length === 2 &&
    Object.keys(options).every(x=>x === 'intentId' || x === 'journalDir'),
    'CPX_RECOVERY_UNSAFE_OPTION');
  const {journalDir, intentId} = options;
  valid(typeof journalDir === 'string' && journalDir.length > 0, 'CPX_RECOVERY_JOURNAL_DIR_REQUIRED');
  // Load the official XRPL library, never a caller-supplied node or callback.
  const { Client } = await import('xrpl');
  return reconcileWithLedger({
    journal:createLocalAttemptJournal(journalDir), intentId,
    makeClient: url => new Client(url)
  });
}
