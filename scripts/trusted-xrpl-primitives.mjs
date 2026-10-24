/**
 * Official XRPL transaction primitives for the private secure Node purchase path.
 * The supported package API MUST NOT accept caller replacements for these.
 * A single fixed Ripple-operated mainnet endpoint is a trust dependency, not
 * a cryptographic consensus quorum.
 */
export const MAINNET_LEDGER_URL = 'wss://s1.ripple.com';
const HASH = /^[0-9A-F]{64}$/;
function required(condition, code) { if (!condition) throw new Error(code); }

/** Private constructor seam: the public API always uses import('xrpl'). */
export function buildTrustedXrplPrimitives(xrpl) {
  required(xrpl && typeof xrpl === 'object' && typeof xrpl.Client === 'function' &&
    typeof xrpl.hashes?.hashSignedTx === 'function', 'CPX_OFFICIAL_XRPL_LIBRARY_REQUIRED');

  function hashSignedTx(signedTxBlob) {
    required(typeof signedTxBlob === 'string' && signedTxBlob.length > 0 &&
      signedTxBlob.length % 2 === 0 && /^[a-fA-F0-9]+$/.test(signedTxBlob),
      'CPX_SIGNED_BLOB_INVALID');
    const hash = xrpl.hashes.hashSignedTx(signedTxBlob);
    required(typeof hash === 'string' && HASH.test(hash.toUpperCase()),
      'CPX_OFFICIAL_SIGNED_HASH_INVALID');
    return hash.toUpperCase();
  }

  async function getValidatedLedgerIndex() {
    const client = new xrpl.Client(MAINNET_LEDGER_URL);
    try {
      await client.connect();
      const index = await client.getLedgerIndex();
      required(Number.isSafeInteger(index) && index > 0 && index <= 0xffffffff,
        'CPX_UNTRUSTED_LEDGER_INDEX');
      return index;
    } finally {
      // No alternate RPC, submitted transaction, or payment keys are involved.
      // A failed disconnect must fail closed rather than authorize signing.
      await client.disconnect();
    }
  }
  return Object.freeze({ hashSignedTx, getValidatedLedgerIndex });
}

export async function loadOfficialXrplPrimitives() {
  const xrpl = await import('xrpl');
  return buildTrustedXrplPrimitives(xrpl);
}
