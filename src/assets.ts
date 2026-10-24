/**
 * Verified XRPL MAINNET asset identifiers for cpX x402 Pay.
 * Issued tokens are ALWAYS identified by (currency code, issuer), not by symbol.
 *
 * XRP: native drops, no issuer.
 * RLUSD: Ripple's XRPL issuance (not EVM RLUSD).
 * USDC: Circle's native XRPL issuance (not bridged USDC or USDC on Base).
 *
 * Sources:
 * https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl
 * https://www.circle.com/blog/now-available-usdc-on-the-xrpl
 * https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md
 */
import type { AgentPaymentConfig } from './policy.js';

export const CPX_XRPL_MAINNET_ASSETS = Object.freeze({
  XRP: Object.freeze({ kind: 'xrp' as const, asset: 'XRP' as const, network: 'xrpl:0' as const }),
  RLUSD: Object.freeze({
    kind: 'issued' as const,
    asset: '524C555344000000000000000000000000000000' as const,
    issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De' as const,
    network: 'xrpl:0' as const
  }),
  USDC: Object.freeze({
    kind: 'issued' as const,
    asset: '5553444300000000000000000000000000000000' as const,
    issuer: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE' as const,
    network: 'xrpl:0' as const
  })
});

export type ThreeAssetLimits = {
  /** XRP's x402 amount is integer DROPS, not XRP units. 50000 = 0.05 XRP. */
  xrpDrops: string;
  /** RLUSD's x402 amount is a decimal token value, e.g. "0.05". */
  rlusd: string;
  /** Circle's XRPL USDC amount is a decimal token value, e.g. "0.05". */
  usdc: string;
};

export type ThreeAssetPolicyOptions = {
  /** All three limits are mandatory and must be positive; no implied unlimited cap. */
  limits: ThreeAssetLimits;
  recipients: AgentPaymentConfig['recipients'];
  approval: AgentPaymentConfig['approval'];
};

/**
 * Builds a policy restricted to the three official cpX mainnet asset identities.
 * This helper DOES NOT create a signer, send a payment, or authorize an operator.
 * Pass to createCpXX402AgentPay({ signer, policy }) and keep the signer isolated.
 */
export function createThreeAssetPolicy(options: ThreeAssetPolicyOptions): AgentPaymentConfig {
  if (!options?.limits) throw new Error('CPX_THREE_ASSET_LIMITS_REQUIRED');
  const { limits, recipients, approval } = options;
  return {
    assets: [
      { kind: 'xrp', asset: CPX_XRPL_MAINNET_ASSETS.XRP.asset, maxAmountDrops: limits.xrpDrops },
      { kind: 'issued', asset: CPX_XRPL_MAINNET_ASSETS.RLUSD.asset,
        issuer: CPX_XRPL_MAINNET_ASSETS.RLUSD.issuer, maxAmount: limits.rlusd },
      { kind: 'issued', asset: CPX_XRPL_MAINNET_ASSETS.USDC.asset,
        issuer: CPX_XRPL_MAINNET_ASSETS.USDC.issuer, maxAmount: limits.usdc }
    ],
    recipients,
    approval
  };
}
