/**
 * cpX x402 Pay: bounded, single-signature guard for a supervised XRPL purchase.
 * NO wallet keys, network requests, or transaction submission in this module.
 * The guarded signer may only sign one validated Payment for one selected x402 offer.
 */
import { compareAmount, type X402Requirements } from './policy.js';

export type XrplSigningTransaction = Record<string, unknown>;
export type MinimalXrplSigner<T extends object> = {
  classicAddress: string;
  sign(transaction: T): Promise<{ signedTxBlob: string; hash?: string }> | { signedTxBlob: string; hash?: string };
};
export type GuardOptions = {
  recipient: string;
  asset: string;
  issuer?: string;
  /** XRP in drops, or issued-token decimal units. */
  exactAmount: string;
  /** For issued tokens, cap token SendMax including any transfer fee. */
  maxSendMax?: string;
  /** The largest signing fee in integer XRP drops. */
  maxFeeDrops: string;
  /** Explicitly opt in to deployed t54 seller conventions for this purchase only. */
  legacyT54Offer?: boolean;
  /** Query XRPL MAINNET's current validated ledger index. Never use a user-controlled value in production. */
  getValidatedLedgerIndex: () => Promise<number>;
};

const INT = /^(0|[1-9][0-9]*)$/;
const ALLOWED_TX_FIELDS = new Set([
  'TransactionType', 'Account', 'Destination', 'DestinationTag', 'SourceTag',
  'Amount', 'DeliverMax', 'SendMax', 'Fee', 'Flags', 'Sequence',
  'LastLedgerSequence', 'InvoiceID', 'NetworkID' // xrpl.js may add an undefined property on mainnet.
]);
function requireCondition(condition: unknown, error: string): asserts condition {
  if (!condition) throw new Error(error);
}
function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}
function validUnsignedDrops(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 18 && INT.test(value);
}
function validIssued(value: unknown, asset: string, issuer: string): value is {value: string; currency: string; issuer: string} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  return Object.keys(x).sort().join(',') === 'currency,issuer,value' &&
    x.currency === asset && x.issuer === issuer && typeof x.value === 'string';
}
async function invoiceHash(invoice: string): Promise<string> {
  const input = new TextEncoder().encode(invoice);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

type BoundOffer = {
  recipient: string; destinationTag?: number; sourceTag?: number; invoiceID: string;
  asset: string; issuer?: string; amount: string; timeout: number;
};

export function createOneShotXrplSigner<T extends object>(
  original: MinimalXrplSigner<T>, options: GuardOptions
) {
  requireCondition(typeof original?.classicAddress === 'string' && original.classicAddress.startsWith('r'), 'CPX_INVALID_SIGNER');
  requireCondition(validUnsignedDrops(options.maxFeeDrops) && BigInt(options.maxFeeDrops) > 0n, 'CPX_INVALID_FEE_CAP');
  requireCondition(options.recipient.length > 0 && options.asset.length > 0, 'CPX_INVALID_GUARD');
  requireCondition(typeof options.getValidatedLedgerIndex === 'function', 'CPX_LEDGER_CHECK_REQUIRED');
  const unit = options.asset === 'XRP' ? 'drops' : 'token';
  requireCondition(compareAmount(options.exactAmount, '0', unit) === 1, 'CPX_INVALID_AMOUNT');
  if (unit === 'token') {
    requireCondition(typeof options.issuer === 'string' && !!options.issuer, 'CPX_ISSUER_REQUIRED');
    requireCondition(typeof options.maxSendMax === 'string' && compareAmount(options.maxSendMax, options.exactAmount, 'token') !== null && compareAmount(options.maxSendMax, options.exactAmount, 'token')! >= 0, 'CPX_INVALID_SENDMAX_CAP');
  } else {
    requireCondition(options.issuer === undefined && options.maxSendMax === undefined, 'CPX_UNEXPECTED_XRP_FIELDS');
  }

  let armed: BoundOffer | undefined;
  let started = false;
  let consumed = false;

  return {
    signer: {
      classicAddress: original.classicAddress,
      async sign(tx: T) {
        requireCondition(armed !== undefined && !started && !consumed, 'CPX_SIGNING_NOT_AUTHORIZED');
        started = true; // BEFORE awaiting anything: racing sign() requests fail closed.
        consumed = true; // No automatic second signing, even after failure.
        const offer = armed;
        requireCondition(tx && typeof tx === 'object' && !Array.isArray(tx), 'CPX_INVALID_TRANSACTION');
        const fields = tx as Record<string, unknown>;
        requireCondition(Object.keys(fields).every(k => ALLOWED_TX_FIELDS.has(k)), 'CPX_UNKNOWN_TRANSACTION_FIELD');
        requireCondition(fields.TransactionType === 'Payment', 'CPX_PAYMENT_ONLY');
        requireCondition(fields.Account === original.classicAddress, 'CPX_WRONG_PAYER');
        requireCondition(fields.Destination === offer.recipient, 'CPX_WRONG_DESTINATION');
        requireCondition(fields.DestinationTag === offer.destinationTag, 'CPX_WRONG_DESTINATION_TAG');
        requireCondition(fields.SourceTag === undefined || offer.sourceTag !== undefined, 'CPX_UNKNOWN_TRANSACTION_FIELD');
        requireCondition(fields.SourceTag === undefined || fields.SourceTag === offer.sourceTag, 'CPX_WRONG_SOURCE_TAG');
        requireCondition(typeof fields.InvoiceID === 'string' && fields.InvoiceID.toUpperCase() === offer.invoiceID, 'CPX_WRONG_INVOICE');
        // XRPL mainnet (xrpl:0) requires NetworkID to be absent from the SIGNED transaction.
        // Official xrpl.js autofill may supply a JavaScript own-property with value undefined.
        // Accept that placeholder only; never accept a concrete NetworkID (including zero).
        requireCondition(fields.NetworkID === undefined, 'CPX_MAINNET_NETWORK_ID_FORBIDDEN');
        requireCondition(!('Paths' in fields) && !('DeliverMin' in fields) && !('Delegate' in fields) && !('Memos' in fields), 'CPX_FORBIDDEN_TRANSACTION_FIELD');
        requireCondition(fields.Flags === undefined || fields.Flags === 0 || fields.Flags === 0x80000000, 'CPX_FORBIDDEN_FLAGS');
        requireCondition(validUnsignedDrops(fields.Fee) && BigInt(fields.Fee) > 0n && BigInt(fields.Fee) <= BigInt(options.maxFeeDrops), 'CPX_FEE_EXCEEDS_LIMIT');
        requireCondition(isUint32(fields.Sequence) && fields.Sequence > 0 && !('TicketSequence' in fields), 'CPX_SEQUENCE_ONLY');
        requireCondition(isUint32(fields.LastLedgerSequence) && fields.LastLedgerSequence > 0, 'CPX_EXPIRY_REQUIRED');
        const ledger = await options.getValidatedLedgerIndex();
        requireCondition(isUint32(ledger) && ledger > 0, 'CPX_LEDGER_CHECK_FAILED');
        const maxLedgerDelta = Math.ceil(offer.timeout / 5) + 2;
        requireCondition((fields.LastLedgerSequence as number) > ledger && (fields.LastLedgerSequence as number) <= ledger + maxLedgerDelta, 'CPX_EXPIRY_OUT_OF_RANGE');
        requireCondition(('Amount' in fields) !== ('DeliverMax' in fields), 'CPX_EXACTLY_ONE_DELIVERY_FIELD');
        const destAmount = fields.DeliverMax ?? fields.Amount;
        if (offer.asset === 'XRP') {
          requireCondition(validUnsignedDrops(destAmount) && compareAmount(destAmount, offer.amount, 'drops') === 0, 'CPX_WRONG_XRP_AMOUNT');
          requireCondition(!('SendMax' in fields), 'CPX_XRP_SENDMAX_FORBIDDEN');
        } else {
          requireCondition(validIssued(destAmount, offer.asset, offer.issuer!) && compareAmount(destAmount.value, offer.amount, 'token') === 0, 'CPX_WRONG_ISSUED_AMOUNT');
          requireCondition(validIssued(fields.SendMax, offer.asset, offer.issuer!), 'CPX_INVALID_SENDMAX');
          const sendMax = (fields.SendMax as {value: string}).value;
          requireCondition(compareAmount(sendMax, offer.amount, 'token') !== null && compareAmount(sendMax, offer.amount, 'token')! >= 0, 'CPX_SENDMAX_BELOW_DELIVERY');
          requireCondition(compareAmount(sendMax, options.maxSendMax!, 'token') !== null && compareAmount(sendMax, options.maxSendMax!, 'token')! <= 0, 'CPX_SENDMAX_EXCEEDS_LIMIT');
        }
        // Normalize ONLY the undefined placeholder, removing it before the wallet signs.
        // This does not add/change a network ID or construct an XRPL transaction.
        if (Object.prototype.hasOwnProperty.call(fields, 'NetworkID') || offer.sourceTag !== undefined) {
          const normalized = { ...fields };
          if (Object.prototype.hasOwnProperty.call(normalized, 'NetworkID')) delete normalized.NetworkID;
          if (normalized.DestinationTag === undefined) delete normalized.DestinationTag;
          if (normalized.SourceTag === undefined) delete normalized.SourceTag;
          if (offer.sourceTag !== undefined) normalized.SourceTag = offer.sourceTag;
          return await original.sign(normalized as T);
        }
        return await original.sign(tx);
      }
    } satisfies MinimalXrplSigner<T>,
    /** Arms the guard for exactly one challenge AFTER x402 policy and human approval. */
    async arm(req: X402Requirements & {maxTimeoutSeconds?: number}) {
      requireCondition(!started && !consumed && !armed, 'CPX_ALREADY_ARMED');
      started = true; // Reserve immediately; asynchronous hash may yield.
      try {
        requireCondition(req.network === 'xrpl:0' && req.scheme === 'exact' &&
          (req.extra?.areFeesSponsored === false ||
            (options.legacyT54Offer === true && req.extra?.areFeesSponsored === undefined)), 'CPX_NOT_XRPL_EXACT');
        requireCondition(req.payTo === options.recipient && req.asset === options.asset && req.amount === options.exactAmount, 'CPX_OFFER_MISMATCH');
        requireCondition(req.extra?.issuer === options.issuer, 'CPX_OFFER_ISSUER_MISMATCH');
        requireCondition(req.extra?.assetTransferMethod === undefined || req.extra.assetTransferMethod === 'sequence', 'CPX_TICKETS_NOT_SUPPORTED');
        requireCondition(isUint32(req.extra?.destinationTag) ||
          (options.legacyT54Offer === true && req.extra?.destinationTag === undefined), 'CPX_DESTINATION_TAG_REQUIRED');
        requireCondition(req.extra?.sourceTag === undefined ||
          (options.legacyT54Offer === true && isUint32(req.extra.sourceTag)), 'CPX_SOURCE_TAG_INVALID');
        requireCondition(typeof req.extra?.invoiceId === 'string' && req.extra.invoiceId.length > 0 && req.extra.invoiceId.length <= 256, 'CPX_INVOICE_REQUIRED');
        requireCondition(typeof req.maxTimeoutSeconds === 'number' && Number.isInteger(req.maxTimeoutSeconds) && req.maxTimeoutSeconds > 0 && req.maxTimeoutSeconds <= (options.legacyT54Offer === true ? 600 : 120), 'CPX_TIMEOUT_INVALID');
        const id = await invoiceHash(req.extra.invoiceId);
        armed = {recipient: req.payTo,
          ...(req.extra?.destinationTag === undefined ? {} : {destinationTag: req.extra.destinationTag}),
          ...(req.extra?.sourceTag === undefined ? {} : {sourceTag: req.extra.sourceTag as number}),
          invoiceID: id,
          asset: req.asset, issuer: req.extra.issuer, amount: req.amount, timeout: req.maxTimeoutSeconds};
      } finally {
        started = false;
      }
    },
    getStatus() { return {armed: !!armed, consumed}; }
  };
}
