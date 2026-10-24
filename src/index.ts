import { Client as CpXXrplClient } from "xrpl";
import { createCpXWireFetch } from "./xrpl_x402_wire.js";
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ExactXrplScheme, type ClientXrplSigner } from '@x402/xrpl';
import { createAgentPaymentGate, type AgentPaymentConfig } from './policy.js';
import { createOneShotXrplSigner, type GuardOptions } from './one_shot_guard.js';

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
export function createCpXX402AgentPay(options: {
  signer: ClientXrplSigner;
  policy: AgentPaymentConfig;
  requestFetch?: typeof fetch;
  /** Strongly recommended for the first supervised purchase; NOT a persistent budget. */
  oneShot?: GuardOptions;
}) {
  const gate = createAgentPaymentGate(options.policy);
  const guarded = options.oneShot ? createOneShotXrplSigner(options.signer, options.oneShot) : undefined;
  const signer = guarded?.signer ?? options.signer;
  const client = new x402Client((_version, requirements) => {
    const chosen = requirements.find(req =>
      req.network === 'xrpl:0' &&
      req.scheme === 'exact' &&
      options.policy.assets.some(asset =>
        asset.asset === req.asset &&
        (asset.kind === 'xrp' || asset.issuer === req.extra?.issuer))
    );
    if (!chosen) throw new Error('CPX_NO_PERMITTED_XRPL_ASSET');
    return chosen;
  }).setSpendControls({
    // Explicitly select only the asset(s) authorized by this agent's policy.
    allowedAssets: options.policy.assets.map(a => ({ network: 'xrpl:0', asset: a.asset }))
  }).register(
    'xrpl:0',
    new ExactXrplScheme(signer, {
      preparePaymentTransaction: async (transaction, requirements) => {
        if (requirements.network !== "xrpl:0") {
          throw new Error("CPX_XRPL_MAINNET_ONLY");
        }

        const seconds = Number(requirements.maxTimeoutSeconds);

        if (!Number.isSafeInteger(seconds) || seconds <= 0) {
          throw new Error("CPX_INVALID_PAYMENT_TIMEOUT");
        }

        const ledger = new CpXXrplClient("wss://s1.ripple.com");

        try {
          await ledger.connect();

          const currentLedger = await ledger.getLedgerIndex();
          const maxLedger =
            currentLedger + Math.ceil(seconds / 5) + 2;

          const expiry = transaction.LastLedgerSequence;

          if (
            expiry !== undefined &&
            (!Number.isSafeInteger(expiry) ||
             expiry <= currentLedger ||
             expiry > maxLedger)
          ) {
            throw new Error("CPX_INVALID_LEDGER_EXPIRY");
          }

          return await ledger.autofill({
            ...transaction,
            LastLedgerSequence: expiry ?? maxLedger
          });
        } finally {
          await ledger.disconnect();
        }
      },

      wsUrlByNetwork: { 'xrpl:0': 'wss://s1.ripple.com' },
      // Never let the guarded signer authorize a TicketCreate transaction.
      ...(guarded ? { ticketCreateCount: 0 } : {})
    })
  );
  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const result = await gate.evaluate({ paymentRequired, selectedRequirements });
    if (!result.allowed) return { abort: true, reason: result.reason };
    if (guarded) {
      try {
        await guarded.arm(selectedRequirements);
      } catch {
        return { abort: true, reason: 'CPX_ONE_SHOT_ARM_FAILED' };
      }
    }
  });
  return {
    paidFetch: wrapFetchWithPayment(createCpXWireFetch(options.requestFetch ?? globalThis.fetch), client),
    client,
    /** For instrumentation only; not evidence of settlement. */
    oneShotStatus: () => guarded?.getStatus()
  };
}
