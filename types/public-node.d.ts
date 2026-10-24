/** cpX x402 Pay supported Node.js API; no wallet keys are handled here. */
import type { ClientXrplSigner } from '@x402/xrpl';
import type { AgentPaymentConfig } from '../dist/src/policy.js';
import type { GuardOptions } from '../dist/src/one_shot_guard.js';

export type SecureNodePurchaseOptions = {
  intent: {
    intentId: string;
    payer: string;
    seller: string;
    resource: string;
    asset: string;
    amount: string;
  };
  journalDir: string;
  /** Strict cumulative single-host spending caps; XRP in drops, tokens in decimal units.
   *  Reservation is not automatically released after a failure or timeout. */
  budgetCaps: { xrpDrops: string; rlusd: string; usdc: string };
  signer: ClientXrplSigner;
  policy: AgentPaymentConfig;
  /** Ledger-index lookup is provided internally from official xrpl.js on mainnet. */
  oneShot: Omit<GuardOptions, 'getValidatedLedgerIndex'>;
  maxFeeDrops: string;
  request: {
    url: string;
    init: { method: 'POST'; body: string; headers?: HeadersInit; signal?: AbortSignal };
  };
  timeoutMs?: number;
};

/** Validate safe configuration without constructing any payment request. */
export declare function validateSecureNodePurchase(options: SecureNodePurchaseOptions): true;

/**
 * Initiates at most one guarded x402 HTTP payment attempt with durable journal.
 * A successful HTTP response is NOT equivalent to verified XRPL settlement.
 */
export declare function executeSecureNodePurchase(options: SecureNodePurchaseOptions): Promise<{
  status: 'HTTP_RESPONSE_LEDGER_UNVERIFIED';
  httpStatus: number;
  paymentResponseHeaderPresent: boolean;
  journalStatus: string;
}>;

/** Read-only, XRPL-mainnet settlement recovery for a previously signed, journaled purchase.
 *  Rejects unknown/unvalidated/failed transactions; NEVER resubmits payments. */
export declare function reconcileSecureNodePurchase(options: {journalDir: string; intentId: string}): Promise<{
  status: 'VALIDATED_SUCCESS';
  transactionHash: string;
  ledgerIndex: number;
  deliveredAmount: string;
  asset: string;
  feeDrops: string;
  invoiceID: string;
}>;
