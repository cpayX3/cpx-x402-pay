/**
 * cpX x402 Pay: XRPL validated-ledger settlement verifier.
 * Pure data verifier: no wallet, signing, network calls, or transaction submission.
 * Caller must fetch a transaction from a trusted XRPL mainnet node using `tx`.
 * A seller's HTTP 200 or payment-response header does NOT replace this check.
 */
import { compareAmount } from './policy.js';

export type ExpectedXrplSettlement = {
  /** SHA-512Half transaction hash as returned by the original signer, 64 hex chars. */
  transactionHash: string;
  payer: string;
  recipient: string;
  destinationTag?: number;
  sourceTag?: number;
  /** SHA-256(invoiceId string), upper-case 64 hex, bound by the signing guard. */
  invoiceID: string;
  asset: string; // XRP, Ripple RLUSD currency, or Circle USDC currency
  issuer?: string;
  amount: string; // XRP: drops. Issued token: decimal value.
  maxFeeDrops: string;
};

type ObjectMap = Record<string, unknown>;
function record(value: unknown): ObjectMap | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectMap : undefined;
}
function required(test: unknown, code: string): asserts test {
  if (!test) throw new Error(code);
}
const HASH = /^[0-9A-Fa-f]{64}$/;
const DROPS = /^(0|[1-9][0-9]*)$/;
const CURRENCY = /^[0-9A-F]{40}$/;
function equalAmount(a: unknown, b: string, unit: 'drops'|'token'): boolean {
  return typeof a === 'string' && compareAmount(a, b, unit) === 0;
}

/** Throws on any uncertain or unexpected result. Never authorizes retry. */
export function verifyValidatedXrplSettlement(payload: unknown, expected: ExpectedXrplSettlement) {
  const outer = record(payload);
  const data = record(outer?.result) ?? outer;
  required(data !== undefined, 'CPX_BAD_LEDGER_RESPONSE');
  required(HASH.test(expected.transactionHash), 'CPX_BAD_EXPECTED_TX_HASH');
  required(HASH.test(expected.invoiceID), 'CPX_BAD_EXPECTED_INVOICE');
  required(typeof expected.payer === 'string' && expected.payer.length > 0 &&
    typeof expected.recipient === 'string' && expected.recipient.length > 0,
    'CPX_BAD_EXPECTED_ADDRESSES');
  required(expected.destinationTag === undefined ||
    (Number.isInteger(expected.destinationTag) && expected.destinationTag >= 0 &&
    expected.destinationTag <= 0xffffffff), 'CPX_BAD_EXPECTED_TAG');
  required(expected.sourceTag === undefined ||
    (Number.isInteger(expected.sourceTag) && expected.sourceTag >= 0 &&
    expected.sourceTag <= 0xffffffff), 'CPX_BAD_EXPECTED_SOURCE_TAG');
  required(DROPS.test(expected.maxFeeDrops) && BigInt(expected.maxFeeDrops) > 0n, 'CPX_BAD_EXPECTED_FEE');

  required(data.validated === true, 'CPX_TX_NOT_VALIDATED');
  const meta = record(data.meta);
  required(meta !== undefined && meta.TransactionResult === 'tesSUCCESS', 'CPX_TX_NOT_SUCCESSFUL');
  const tx = record(data.tx_json) ?? record(data.tx) ?? data;
  const actualHash = data.hash ?? tx.hash;
  required(typeof actualHash === 'string' && actualHash.toUpperCase() === expected.transactionHash.toUpperCase(), 'CPX_TX_HASH_MISMATCH');
  required(tx.TransactionType === 'Payment', 'CPX_NOT_A_PAYMENT');
  required(tx.Account === expected.payer, 'CPX_WRONG_PAYER');
  required(tx.Destination === expected.recipient, 'CPX_WRONG_RECIPIENT');
  required(tx.DestinationTag === expected.destinationTag, 'CPX_WRONG_TAG');
  required(tx.SourceTag === expected.sourceTag, 'CPX_WRONG_SOURCE_TAG');
  required(typeof tx.InvoiceID === 'string' && tx.InvoiceID.toUpperCase() === expected.invoiceID.toUpperCase(), 'CPX_WRONG_INVOICE');
  required(typeof tx.Fee === 'string' && DROPS.test(tx.Fee) &&
    BigInt(tx.Fee) > 0n && BigInt(tx.Fee) <= BigInt(expected.maxFeeDrops), 'CPX_FEE_MISMATCH');
  required(typeof data.ledger_index === 'number' && Number.isSafeInteger(data.ledger_index) &&
    data.ledger_index > 0, 'CPX_MISSING_VALIDATED_LEDGER');

  // XRPL v2 uses DeliverMax, v1 uses Amount; delivered_amount is authoritative.
  const requested = tx.DeliverMax ?? tx.Amount;
  const delivered = meta.delivered_amount;
  const unit = expected.asset === 'XRP' ? 'drops' : 'token';
  if (unit === 'drops') {
    required(expected.issuer === undefined && equalAmount(requested, expected.amount, 'drops'), 'CPX_WRONG_XRP_REQUEST');
    required(equalAmount(delivered, expected.amount, 'drops'), 'CPX_WRONG_XRP_DELIVERY');
  } else {
    required(CURRENCY.test(expected.asset) && typeof expected.issuer === 'string' && expected.issuer.startsWith('r'), 'CPX_BAD_EXPECTED_ASSET');
    for (const [label, candidate] of [['REQUEST', requested], ['DELIVERY', delivered]] as const) {
      const value = record(candidate);
      required(value !== undefined && value.currency === expected.asset &&
        value.issuer === expected.issuer && equalAmount(value.value, expected.amount, 'token'), `CPX_WRONG_${label}`);
    }
  }
  return Object.freeze({
    status: 'VALIDATED_SUCCESS' as const,
    transactionHash: expected.transactionHash.toUpperCase(),
    ledgerIndex: data.ledger_index as number,
    deliveredAmount: expected.amount,
    asset: expected.asset,
    feeDrops: tx.Fee as string,
    invoiceID: expected.invoiceID.toUpperCase()
  });
}
