export const CPX_XRPL_MAINNET_ASSETS = Object.freeze({
    XRP: Object.freeze({ kind: 'xrp', asset: 'XRP', network: 'xrpl:0' }),
    RLUSD: Object.freeze({
        kind: 'issued',
        asset: '524C555344000000000000000000000000000000',
        issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
        network: 'xrpl:0'
    }),
    USDC: Object.freeze({
        kind: 'issued',
        asset: '5553444300000000000000000000000000000000',
        issuer: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE',
        network: 'xrpl:0'
    })
});
/**
 * Builds a policy restricted to the three official cpX mainnet asset identities.
 * This helper DOES NOT create a signer, send a payment, or authorize an operator.
 * Pass to createCpXX402AgentPay({ signer, policy }) and keep the signer isolated.
 */
export function createThreeAssetPolicy(options) {
    if (!options?.limits)
        throw new Error('CPX_THREE_ASSET_LIMITS_REQUIRED');
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
