/**
 * cpX x402 Pay Node.js payment entry point.
 * One caller-facing function wires safe HTTPS-only Node transport, one-shot
 * XRPL signing constraints, and the durable same-intent purchase journal.
 * This does NOT make the lower-level SDK impossible to invoke unsafely;
 * before publication the public package exports must be restricted/audited.
 */
import { createSafeAgentFetch, validateSellerUrl } from './safe-agent-fetch.mjs';
import { createLocalAttemptJournal } from './local-attempt-journal.mjs';
import { createPersistentSpendingBudget, validateBudgetCaps } from './persistent-spending-budget.mjs';
import { executeDurablePurchase } from './durable-purchase-lifecycle.mjs';
import { loadOfficialXrplPrimitives } from './trusted-xrpl-primitives.mjs';

const KEYS = new Set([
  'intent', 'journalDir', 'signer', 'policy', 'oneShot',
  'maxFeeDrops', 'request', 'timeoutMs', 'budgetCaps'
]);
const INT = /^(0|[1-9][0-9]*)$/;
const OWN = Object.prototype.hasOwnProperty;
function fail(code) { throw new Error(code); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function requireValue(ok, code) { if (!ok) fail(code); }

export function validateSecureNodePurchase(options) {
  requireValue(object(options), 'CPX_SECURE_OPTIONS_REQUIRED');
  requireValue(Object.keys(options).every(key => KEYS.has(key)), 'CPX_UNSAFE_OPTION_FORBIDDEN');
  const { intent, journalDir, signer, policy, oneShot,
    maxFeeDrops, request, timeoutMs = 20000, budgetCaps } = options;
  validateBudgetCaps(budgetCaps);
  requireValue(object(intent) && typeof intent.intentId === 'string' && intent.intentId.length >= 12,
    'CPX_STABLE_INTENT_ID_REQUIRED');
  requireValue(typeof intent.resource === 'string' && typeof intent.seller === 'string' &&
    typeof intent.payer === 'string' && typeof intent.asset === 'string' && typeof intent.amount === 'string',
    'CPX_PURCHASE_INTENT_REQUIRED');
  validateSellerUrl(intent.resource); // reject unsafe URL before reserving journal or signing
  requireValue(typeof journalDir === 'string' && journalDir.length > 0,
    'CPX_DURABLE_JOURNAL_PATH_REQUIRED');
  requireValue(object(signer) && signer.classicAddress === intent.payer && typeof signer.sign === 'function',
    'CPX_WRONG_OR_MISSING_PAYER_SIGNER');
  requireValue(object(policy), 'CPX_POLICY_REQUIRED');
  requireValue(object(oneShot) && oneShot.recipient === intent.seller &&
    oneShot.asset === intent.asset && oneShot.exactAmount === intent.amount &&
    !OWN.call(oneShot, 'getValidatedLedgerIndex'), 'CPX_ONE_SHOT_INTENT_MISMATCH');
  requireValue(typeof maxFeeDrops === 'string' && INT.test(maxFeeDrops) && BigInt(maxFeeDrops) > 0n &&
    oneShot.maxFeeDrops === maxFeeDrops, 'CPX_FEE_CEILING_MISMATCH');
  requireValue((intent.asset === 'XRP' && oneShot.issuer === undefined && oneShot.maxSendMax === undefined) ||
    (intent.asset !== 'XRP' && typeof oneShot.issuer === 'string' &&
      typeof oneShot.maxSendMax === 'string'), 'CPX_ASSET_GUARD_REQUIRED');
  requireValue(object(request) && request.url === intent.resource && object(request.init),
    'CPX_RESOURCE_MISMATCH');
  requireValue((request.init.method ?? 'GET').toUpperCase() === 'POST', 'CPX_POST_REQUIRED');
  requireValue(typeof request.init.body === 'string' && request.init.body.length <= 262144,
    'CPX_REQUEST_BODY_REQUIRED');
  requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000,
    'CPX_INVALID_HTTP_TIMEOUT');
  requireValue(!OWN.call(request.init, 'signal') || request.init.signal instanceof AbortSignal,
    'CPX_BAD_ABORT_SIGNAL');
  // Only the first unpaid request is caller supplied. The official x402 client
  // alone can populate the payment-signature header on its paid retry.
  const headers = new Headers(request.init.headers);
  for (const h of ['payment-signature', 'x-payment', 'authorization', 'cookie']) {
    requireValue(!headers.has(h), 'CPX_CREDENTIALS_IN_INITIAL_REQUEST_FORBIDDEN');
  }
  // The normal requestFetch override is deliberately not an option here.
  return true;
}

export async function executeSecureNodePurchase(options) {
  validateSecureNodePurchase(options);
  // Imported at runtime from the pinned official xrpl package; no caller injection.
  const trusted = await loadOfficialXrplPrimitives();
  const lockedOneShot = { ...options.oneShot, getValidatedLedgerIndex:trusted.getValidatedLedgerIndex };
  const { createCpXX402AgentPay } = await import('../dist/src/index.js');
  const journal = createLocalAttemptJournal(options.journalDir);
  const budget = createPersistentSpendingBudget(options.journalDir);
  const safeNodeFetch = createSafeAgentFetch({timeoutMs: options.timeoutMs ?? 20000});
  return executeDurablePurchase({
    journal,
    intent: options.intent,
    reserveBudget: intent => budget.reserve({intent,issuer:options.oneShot.issuer,caps:options.budgetCaps,
      maxFeeDrops:options.maxFeeDrops,maxSendMax:options.oneShot.maxSendMax}),
    signer: options.signer,
    hashSignedTx: trusted.hashSignedTx,
    maxFeeDrops: options.maxFeeDrops,
    request: options.request,
    createPaymentClient: journaledSigner => createCpXX402AgentPay({
      signer: journaledSigner,
      policy: options.policy,
      oneShot: lockedOneShot,
      requestFetch: safeNodeFetch
    })
  });
}
