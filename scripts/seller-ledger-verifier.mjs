import { Client, decode } from "xrpl";
import { createHash } from "node:crypto";
import { MAINNET_LEDGER_URL } from "./trusted-xrpl-primitives.mjs";
import { getSellerTransactionHash } from "./seller-transaction-guard.mjs";

const HASH = /^[0-9A-F]{64}$/;

function fail(code) {
  throw new Error(code);
}

function decimal(value) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  ) {
    fail("CPX_SELLER_LEDGER_AMOUNT_INVALID");
  }

  const [whole, fraction = ""] = value.split(".");
  return [whole.replace(/^0+/, '') || '0', fraction.replace(/0+$/, '')];
}

function compareDecimal(a, b) {
  const [aw, af] = decimal(a);
  const [bw, bf] = decimal(b);
  if (aw.length !== bw.length) return aw.length < bw.length ? -1 : 1;
  if (aw !== bw) return aw < bw ? -1 : 1;
  const length = Math.max(af.length, bf.length);
  const x = af.padEnd(length, '0');
  const y = bf.padEnd(length, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Checks ledger evidence against the signed transaction and the
 * exact x402 requirements. No facilitator claim is trusted here.
 */
export function verifySellerLedgerEvidence({
  ledgerResult,
  signedTxBlob,
  requirements
}) {
  const expectedHash = getSellerTransactionHash(signedTxBlob);

  let signed;
  try {
    signed = decode(signedTxBlob);
  } catch {
    fail("CPX_SELLER_SIGNED_TRANSACTION_INVALID");
  }

  if (
    !requirements ||
    requirements.network !== "xrpl:0" ||
    typeof requirements.payTo !== "string" ||
    typeof requirements.asset !== "string" ||
    typeof requirements.amount !== "string"
  ) {
    fail("CPX_SELLER_LEDGER_REQUIREMENTS_INVALID");
  }

  // Independently enforce the requested currency on the
  // ACTUAL signed XRPL transaction, not just ledger metadata.
  if (
    signed.TransactionType !== "Payment" ||
    signed.Destination !== requirements.payTo ||
    signed.Paths !== undefined ||
    signed.DeliverMin !== undefined ||
    (typeof signed.Flags === "number" &&
      (signed.Flags & 0x00020000) !== 0)
  ) {
    fail("CPX_SELLER_SIGNED_PAYMENT_MISMATCH");
  }

  // XRPL x402 exact: precisely one destination amount field.
  if (
    (signed.DeliverMax === undefined) ===
    (signed.Amount === undefined)
  ) {
    fail("CPX_SELLER_INVALID_DELIVERY_FIELDS");
  }

  const signedAmount = signed.DeliverMax ?? signed.Amount;

  if (requirements.asset === "XRP") {
    if (
      typeof signedAmount !== "string" ||
      !/^[0-9]+$/.test(signedAmount) ||
      !/^[0-9]+$/.test(requirements.amount) ||
      BigInt(signedAmount) !== BigInt(requirements.amount) ||
      signed.SendMax !== undefined
    ) {
      fail("CPX_SELLER_SIGNED_ASSET_MISMATCH");
    }
  } else {
    const expectedIssuer = requirements.extra?.issuer;

    if (
      !signedAmount ||
      typeof signedAmount !== "object" ||
      signedAmount.currency !== requirements.asset ||
      signedAmount.issuer !== expectedIssuer ||
      compareDecimal(signedAmount.value, requirements.amount) !== 0 ||
      !signed.SendMax ||
      typeof signed.SendMax !== "object" ||
      signed.SendMax.currency !== requirements.asset ||
      signed.SendMax.issuer !== expectedIssuer ||
      compareDecimal(signed.SendMax.value, requirements.amount) < 0
    ) {
      fail("CPX_SELLER_SIGNED_ASSET_MISMATCH");
    }
  }

  const invoiceId = requirements.extra?.invoiceId;
  const destinationTag = requirements.extra?.destinationTag;

  if ((invoiceId !== undefined && (typeof invoiceId !== 'string' || invoiceId.length < 1 || invoiceId.length > 256)) ||
      (destinationTag !== undefined && (!Number.isSafeInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff))) {
    fail("CPX_SELLER_LEDGER_INVOICE_OR_TAG_REQUIRED");
  }

  const expectedInvoice = invoiceId === undefined ? undefined : createHash('sha256')
    .update(invoiceId, 'utf8').digest('hex').toUpperCase();

  if ((expectedInvoice !== undefined && signed.InvoiceID?.toUpperCase() !== expectedInvoice) ||
      (destinationTag !== undefined && signed.DestinationTag !== destinationTag)) {
    fail("CPX_SELLER_SIGNED_INVOICE_OR_TAG_MISMATCH");
  }

  if (
    requirements.extra?.sourceTag !== undefined &&
    signed.SourceTag !== requirements.extra.sourceTag
  ) {
    fail("CPX_SELLER_SIGNED_SOURCE_TAG_MISMATCH");
  }

  const tx = ledgerResult?.tx_json ?? ledgerResult?.tx;

  // Reject contradictory delivery fields in ledger evidence.
  // The signed transaction is independently checked above.
  if (
    tx &&
    typeof tx === "object" &&
    tx.Amount !== undefined &&
    tx.DeliverMax !== undefined
  ) {
    fail("CPX_SELLER_INVALID_DELIVERY_FIELDS");
  }

  const meta = ledgerResult?.meta ?? ledgerResult?.metaData;

  const reportedHash = ledgerResult?.hash ?? tx?.hash;

  if (
    ledgerResult?.validated !== true ||
    typeof reportedHash !== "string" ||
    !HASH.test(reportedHash.toUpperCase()) ||
    reportedHash.toUpperCase() !== expectedHash ||
    !Number.isSafeInteger(ledgerResult.ledger_index) ||
    ledgerResult.ledger_index <= 0 ||
    meta?.TransactionResult !== "tesSUCCESS" ||
    tx?.TransactionType !== "Payment" ||
    tx?.Destination !== requirements.payTo
  ) {
    fail("CPX_SELLER_LEDGER_PAYMENT_NOT_CONFIRMED");
  }

  // A successful Payment result must contain a concrete delivered
  // amount. Do not infer delivery solely from the transaction request.
  if (
    requirements.extra?.sourceTag !== undefined &&
    tx.SourceTag !== requirements.extra.sourceTag
  ) {
    fail("CPX_SELLER_LEDGER_SOURCE_TAG_MISMATCH");
  }

  const delivered = meta.delivered_amount;

  if (requirements.asset === "XRP") {
    if (
      typeof delivered !== "string" ||
      !/^[0-9]+$/.test(delivered) ||
      !/^[0-9]+$/.test(requirements.amount) ||
      BigInt(delivered) !== BigInt(requirements.amount)
    ) {
      fail("CPX_SELLER_LEDGER_AMOUNT_MISMATCH");
    }
  } else {
    if (
      !delivered ||
      typeof delivered !== "object" ||
      delivered.currency !== requirements.asset ||
      delivered.issuer !== requirements.extra?.issuer ||
      compareDecimal(delivered.value, requirements.amount) !== 0
    ) {
      fail("CPX_SELLER_LEDGER_ASSET_MISMATCH");
    }
  }

  if (requirements.extra?.destinationTag !== undefined &&
      tx.DestinationTag !== requirements.extra.destinationTag) {
    fail("CPX_SELLER_LEDGER_DESTINATION_TAG_MISMATCH");
  }

  if ((expectedInvoice !== undefined && tx.InvoiceID?.toUpperCase() !== expectedInvoice) ||
      (destinationTag !== undefined && tx.DestinationTag !== destinationTag) ||
      tx.Account !== signed.Account ||
      tx.Fee !== signed.Fee ||
      (tx.SourceTag ?? undefined) !==
        (signed.SourceTag ?? undefined)) {
    fail("CPX_SELLER_LEDGER_TRANSACTION_FIELDS_MISMATCH");
  }

  return Object.freeze({
    validated: true,
    transaction: expectedHash,
    network: "xrpl:0",
    ledgerIndex: ledgerResult.ledger_index
  });
}

/**
 * Production verifier uses the fixed Ripple-operated XRPL mainnet
 * endpoint. This is a single-provider trust dependency, not quorum.
 * Never supplies signing keys or submits a transaction.
 */
export async function confirmSellerLedgerPayment({
  signedTxBlob,
  requirements
}) {
  const hash = getSellerTransactionHash(signedTxBlob);
  const client = new Client(MAINNET_LEDGER_URL);

  try {
    await client.connect();

    const response = await client.request({
      command: "tx",
      transaction: hash,
      binary: false,
      api_version: 2
    });

    return verifySellerLedgerEvidence({
      ledgerResult: response.result,
      signedTxBlob,
      requirements
    });
  } finally {
    await client.disconnect();
  }
}
