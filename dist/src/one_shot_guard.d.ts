/**
 * cpX x402 Pay: bounded, single-signature guard for a supervised XRPL purchase.
 * NO wallet keys, network requests, or transaction submission in this module.
 * The guarded signer may only sign one validated Payment for one selected x402 offer.
 */
import { type X402Requirements } from './policy.js';
export type XrplSigningTransaction = Record<string, unknown>;
export type MinimalXrplSigner<T extends object> = {
    classicAddress: string;
    sign(transaction: T): Promise<{
        signedTxBlob: string;
        hash?: string;
    }> | {
        signedTxBlob: string;
        hash?: string;
    };
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
export declare function createOneShotXrplSigner<T extends object>(original: MinimalXrplSigner<T>, options: GuardOptions): {
    signer: {
        classicAddress: string;
        sign(tx: T): Promise<{
            signedTxBlob: string;
            hash?: string;
        } | {
            signedTxBlob: string;
            hash?: string;
        }>;
    };
    /** Arms the guard for exactly one challenge AFTER x402 policy and human approval. */
    arm(req: X402Requirements & {
        maxTimeoutSeconds?: number;
    }): Promise<void>;
    getStatus(): {
        armed: boolean;
        consumed: boolean;
    };
};
