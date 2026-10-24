import { x402Client } from '@x402/core/client';
import { type ClientXrplSigner } from '@x402/xrpl';
import { type AgentPaymentConfig } from './policy.js';
import { type GuardOptions } from './one_shot_guard.js';
export { compareAmount, createAgentPaymentGate } from './policy.js';
export { CPX_XRPL_MAINNET_ASSETS, createThreeAssetPolicy } from './assets.js';
export { createOneShotXrplSigner } from './one_shot_guard.js';
export type { GuardOptions } from './one_shot_guard.js';
export type { ThreeAssetLimits, ThreeAssetPolicyOptions } from './assets.js';
export type { AgentPaymentConfig, PaymentIntent, XrplAsset, X402Requirements } from './policy.js';
/**
 * Bring-your-own XRPL signer. One-shot mode binds the selected x402 offer
 * to a checked transaction just before sign() runs.
 * Self-funded agents own their keys; they can bypass SDK restrictions if they
 * deliberately use their own signer outside the SDK.
 */
export declare function createCpXX402AgentPay(options: {
    signer: ClientXrplSigner;
    policy: AgentPaymentConfig;
    requestFetch?: typeof fetch;
    /** Strongly recommended for the first supervised purchase; NOT a persistent budget. */
    oneShot?: GuardOptions;
}): {
    paidFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    client: x402Client;
    /** For instrumentation only; not evidence of settlement. */
    oneShotStatus: () => {
        armed: boolean;
        consumed: boolean;
    } | undefined;
};
