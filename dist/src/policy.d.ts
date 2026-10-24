/**
 * cpX x402 Pay — self-funded agent policy gate.
 * No account, Supabase, Cloudflare, Xaman, or private keys are required here.
 * NOTE: XRP x402 amounts are DROPS. XRPL-issued tokens use decimal token values.
 */
export type XrplAsset = {
    kind: 'xrp';
    asset: 'XRP';
    maxAmountDrops: string;
} | {
    kind: 'issued';
    asset: string;
    issuer: string;
    maxAmount: string;
};
export type X402Requirements = {
    network: string;
    scheme: string;
    asset: string;
    amount: string;
    payTo: string;
    extra?: {
        issuer?: string;
        areFeesSponsored?: unknown;
        assetTransferMethod?: string;
        [name: string]: unknown;
    };
};
export type PaymentChallenge = {
    paymentRequired: {
        x402Version?: number;
    };
    selectedRequirements: X402Requirements;
};
export type PaymentIntent = {
    network: 'xrpl:0';
    asset: string;
    amount: string;
    amountUnit: 'drops' | 'token';
    issuer?: string;
    recipient: string;
};
export type AgentPaymentConfig = {
    /** Required positive caps; no implicit unlimited spending. */
    assets: readonly XrplAsset[];
    /** Explicitly choose permissionless destinations or an allowlist. */
    recipients: {
        mode: 'any';
    } | {
        mode: 'allowlist';
        addresses: readonly string[];
    };
    /** Autonomous approval must be explicitly selected by the agent operator. */
    /** Opt-in support for live t54-oriented challenges omitting areFeesSponsored. */
    legacyT54Offer?: boolean;
    approval: {
        mode: 'autonomous';
    } | {
        mode: 'callback';
        authorize: (intent: PaymentIntent) => Promise<boolean>;
    };
};
export type GateResult = {
    allowed: true;
    intent: PaymentIntent;
} | {
    allowed: false;
    reason: string;
};
/** Compare nonnegative decimal strings without Number / float rounding. */
export declare function compareAmount(a: string, b: string, units: 'drops' | 'token'): number | null;
export declare function createAgentPaymentGate(config: AgentPaymentConfig): {
    evaluate(challenge: PaymentChallenge): Promise<GateResult>;
};
