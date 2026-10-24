/**
 * cpX x402 Pay: local, self-funded-agent purchase lifecycle.
 * No network, wallet, transaction builder, or submission code is included here.
 * IMPORTANT: call executeDurablePurchase with the signer factory INSIDE the
 * exclusive journal reservation. The factory MUST apply createCpXX402AgentPay's
 * oneShot transaction guard around the provided journaledSigner.
 * Never use this local file journal for multi-host delegated/managed accounts.
 */
const HEX64 = /^[0-9a-fA-F]{64}$/;
const DROPS = /^(0|[1-9][0-9]*)$/;
function requireCondition(ok, code) { if (!ok) throw new Error(code); }
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function transactionExpectation(tx, hash, maxFeeDrops) {
  requireCondition(isRecord(tx) && tx.TransactionType === 'Payment', 'CPX_JOURNAL_NOT_PAYMENT');
  requireCondition(typeof tx.Account === 'string' && typeof tx.Destination === 'string', 'CPX_JOURNAL_BAD_ADDRESS');
  requireCondition(tx.DestinationTag === undefined ||
    (Number.isInteger(tx.DestinationTag) && tx.DestinationTag >= 0 && tx.DestinationTag <= 0xffffffff), 'CPX_JOURNAL_BAD_TAG');
  requireCondition(tx.SourceTag === undefined ||
    (Number.isInteger(tx.SourceTag) && tx.SourceTag >= 0 && tx.SourceTag <= 0xffffffff), 'CPX_JOURNAL_BAD_SOURCE_TAG');
  requireCondition(typeof tx.InvoiceID === 'string' && HEX64.test(tx.InvoiceID), 'CPX_JOURNAL_BAD_INVOICE');
  requireCondition(DROPS.test(maxFeeDrops) && BigInt(maxFeeDrops) > 0n, 'CPX_JOURNAL_BAD_FEE_CAP');
  requireCondition(typeof tx.Fee === 'string' && DROPS.test(tx.Fee) && BigInt(tx.Fee) > 0n && BigInt(tx.Fee) <= BigInt(maxFeeDrops), 'CPX_JOURNAL_FEE_EXCEEDS_CAP');
  requireCondition(
    Number.isSafeInteger(tx.LastLedgerSequence) &&
    tx.LastLedgerSequence > 0 &&
    tx.LastLedgerSequence <= 0xffffffff,
    'CPX_JOURNAL_LAST_LEDGER_REQUIRED'
  );
  const value = tx.DeliverMax ?? tx.Amount;
  let asset, issuer, amount;
  if (typeof value === 'string') {
    asset = 'XRP'; amount = value;
    requireCondition(DROPS.test(amount) && BigInt(amount) > 0n, 'CPX_JOURNAL_BAD_XRP');
  } else {
    requireCondition(isRecord(value) && typeof value.currency === 'string' && typeof value.issuer === 'string' && typeof value.value === 'string', 'CPX_JOURNAL_BAD_TOKEN');
    asset = value.currency; issuer = value.issuer; amount = value.value;
  }
  return {transactionHash: hash, payer: tx.Account, recipient: tx.Destination,
    ...(tx.DestinationTag === undefined ? {} : {destinationTag:tx.DestinationTag}),
    ...(tx.SourceTag === undefined ? {} : {sourceTag:tx.SourceTag}),
    invoiceID: tx.InvoiceID.toUpperCase(),
    lastLedgerSequence: tx.LastLedgerSequence,
    asset, ...(issuer === undefined ? {} : {issuer}), amount, maxFeeDrops};
}

/** Persist the original signed transaction hash BEFORE returning the blob to x402. */
export function createJournaledSigner({signer, journal, intentId, hashSignedTx, maxFeeDrops}) {
  requireCondition(typeof signer?.classicAddress === 'string' && typeof signer.sign === 'function', 'CPX_SIGNER_REQUIRED');
  requireCondition(typeof journal?.signed === 'function', 'CPX_JOURNAL_REQUIRED');
  requireCondition(typeof hashSignedTx === 'function', 'CPX_OFFICIAL_SIGNED_HASH_FUNCTION_REQUIRED');
  let invoked = false;
  return {
    classicAddress: signer.classicAddress,
    async sign(tx) {
      requireCondition(!invoked, 'CPX_JOURNAL_SIGNER_ALREADY_USED');
      invoked = true; // fail-closed even if an await fails or two calls overlap
      const signed = await signer.sign(tx); // should be invoked THROUGH the official one-shot guard
      requireCondition(typeof signed?.signedTxBlob === 'string' && signed.signedTxBlob.length > 0, 'CPX_SIGNER_NO_BLOB');
      const hash = hashSignedTx(signed.signedTxBlob);
      requireCondition(typeof hash === 'string' && HEX64.test(hash), 'CPX_INVALID_COMPUTED_HASH');
      if (signed.hash !== undefined) {
        requireCondition(typeof signed.hash === 'string' && signed.hash.toUpperCase() === hash.toUpperCase(), 'CPX_SIGNED_HASH_MISMATCH');
      }
      const expected = transactionExpectation(tx, hash.toUpperCase(), maxFeeDrops);
      requireCondition(tx.Account === signer.classicAddress, 'CPX_JOURNAL_PAYER_MISMATCH');
      await journal.signed(intentId, hash.toUpperCase(), expected); // fsync + atomic rename
      return signed; // NEVER returned if durable persistence fails
    }
  };
}

/**
 * Reserve a stable economic intent BEFORE requesting the x402 resource.
 * createPaymentClient MUST return a guarded SDK instance whose oneShot is ON.
 * Returning HTTP 200 is intentionally not treated as validated settlement.
 */
export async function executeDurablePurchase({journal, intent, signer, hashSignedTx, maxFeeDrops, createPaymentClient, request, reserveBudget}) {
  requireCondition(typeof journal?.reserve === 'function', 'CPX_JOURNAL_REQUIRED');
  requireCondition(typeof createPaymentClient === 'function', 'CPX_CLIENT_FACTORY_REQUIRED');
  requireCondition(typeof reserveBudget === 'function', 'CPX_BUDGET_RESERVATION_REQUIRED');
  requireCondition(typeof request?.url === 'string' && request.url === intent.resource, 'CPX_RESOURCE_MISMATCH');
  await journal.reserve(intent); // duplicates and concurrent same-ID attempts fail here
  // Must hold durable capacity before constructing any payment client, HTTP or signer.
  // A crash between intent and budget reservation intentionally blocks retry.
  await reserveBudget(intent);
  const journaledSigner = createJournaledSigner({signer, journal, intentId: intent.intentId, hashSignedTx, maxFeeDrops});
  // Caller must use createCpXX402AgentPay({signer:journaledSigner, policy, oneShot:{...}})
  const buyer = await createPaymentClient(journaledSigner);
  requireCondition(typeof buyer?.paidFetch === 'function' && typeof buyer?.oneShotStatus === 'function', 'CPX_ONE_SHOT_CLIENT_REQUIRED');
  // Never retry automatically. If this throws or times out, the intent stays blocked.
  const response = await buyer.paidFetch(request.url, request.init);
  // Capture seller rejection text for diagnostics; never treat it as settlement proof.
  let rejectionBody;
  if (response.status !== 200) {
    try { rejectionBody = (await response.clone().text()).slice(0, 2048); }
    catch { rejectionBody = 'SELLER_RESPONSE_BODY_UNAVAILABLE'; }
  }
  return {status: 'HTTP_RESPONSE_LEDGER_UNVERIFIED',
    ...(rejectionBody === undefined ? {} : {rejectionBody}), httpStatus: response.status,
    paymentResponseHeaderPresent: response.headers?.has?.('payment-response') === true,
    journalStatus: (await journal.load(intent.intentId)).status};
}

/** Strict read-only reconciliation. No submission or retry is possible here. */
export async function reconcileDurablePurchase({journal, intentId, lookupValidatedTransaction, verifyValidatedXrplSettlement}) {
  requireCondition(typeof lookupValidatedTransaction === 'function' && typeof verifyValidatedXrplSettlement === 'function', 'CPX_RECONCILER_REQUIRED');
  const state = await journal.load(intentId);
  requireCondition(state.status === 'SIGNED_SUBMISSION_UNKNOWN' && isRecord(state.expected), 'CPX_NO_SIGNED_EXPECTATION_TO_RECONCILE');
  // The lookup must query an independently trusted XRPL mainnet node, NOT the seller.
  const ledgerResponse = await lookupValidatedTransaction(state.transactionHash);
  const receipt = verifyValidatedXrplSettlement(ledgerResponse, state.expected);
  await journal.validated(intentId, receipt);
  return receipt;
}
