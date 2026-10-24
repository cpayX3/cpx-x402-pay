/**
 * cpX x402 Pay — self-funded agent policy gate.
 * No account, Supabase, Cloudflare, Xaman, or private keys are required here.
 * NOTE: XRP x402 amounts are DROPS. XRPL-issued tokens use decimal token values.
 */
export type XrplAsset =
  | { kind: 'xrp'; asset: 'XRP'; maxAmountDrops: string }
  | { kind: 'issued'; asset: string; issuer: string; maxAmount: string };

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
  paymentRequired: { x402Version?: number };
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
  recipients: { mode: 'any' } | { mode: 'allowlist'; addresses: readonly string[] };
  /** Autonomous approval must be explicitly selected by the agent operator. */
  /** Opt-in support for live t54-oriented challenges omitting areFeesSponsored. */
  legacyT54Offer?: boolean;
  approval: { mode: 'autonomous' } | {
    mode: 'callback';
    authorize: (intent: PaymentIntent) => Promise<boolean>;
  };
};

export type GateResult =
  | { allowed: true; intent: PaymentIntent }
  | { allowed: false; reason: string };

const DIGITS = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
// Syntax gate only, NOT XRPL address checksum verification.
const CLASSIC_ADDRESS_SHAPE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const ISSUED_CURRENCY_SHAPE = /^(?:[A-Za-z0-9]{3}|[A-Fa-f0-9]{40})$/;

/** Compare nonnegative decimal strings without Number / float rounding. */
export function compareAmount(a: string, b: string, units: 'drops' | 'token'): number | null {
  if (a.length > 64 || b.length > 64) return null;
  const valid = units === 'drops' ? DIGITS : DECIMAL;
  if (!valid.test(a) || !valid.test(b)) return null;
  const [aw, af = ''] = a.split('.');
  const [bw, bf = ''] = b.split('.');
  const places = Math.max(af.length, bf.length);
  const nA = BigInt(aw + af.padEnd(places, '0'));
  const nB = BigInt(bw + bf.padEnd(places, '0'));
  return nA < nB ? -1 : nA > nB ? 1 : 0;
}

function assetKey(asset: XrplAsset): string {
  return asset.kind === 'xrp' ? 'XRP' : `${asset.asset}|${asset.issuer}`;
}

function isPositiveCap(asset: XrplAsset): boolean {
  const value = asset.kind === 'xrp' ? asset.maxAmountDrops : asset.maxAmount;
  const units = asset.kind === 'xrp' ? 'drops' : 'token';
  return compareAmount(value, '0', units) === 1;
}

export function createAgentPaymentGate(config: AgentPaymentConfig) {
  if (!config.assets?.length || !config.assets.every(isPositiveCap)) {
    throw new Error('CPX_INVALID_ASSET_CAP');
  }
  const names = config.assets.map(assetKey);
  if (new Set(names).size !== names.length) throw new Error('CPX_DUPLICATE_ASSET');
  if (config.assets.some(a =>
    (a.kind === 'issued' && (!CLASSIC_ADDRESS_SHAPE.test(a.issuer) ||
        !ISSUED_CURRENCY_SHAPE.test(a.asset) || a.asset === 'XRP')) ||
    (a.kind === 'xrp' && a.asset !== 'XRP')
  )) throw new Error('CPX_INVALID_ASSET_DEFINITION');
  if (config.recipients?.mode !== 'any' && config.recipients?.mode !== 'allowlist')
    throw new Error('CPX_RECIPIENT_POLICY_REQUIRED');
  if (config.recipients.mode === 'allowlist' && config.recipients.addresses.length === 0)
    throw new Error('CPX_EMPTY_RECIPIENT_ALLOWLIST');
  if (config.approval?.mode !== 'autonomous' && config.approval?.mode !== 'callback')
    throw new Error('CPX_APPROVAL_POLICY_REQUIRED');
  if (config.approval.mode === 'callback' && typeof config.approval.authorize !== 'function')
    throw new Error('CPX_APPROVAL_CALLBACK_REQUIRED');

  const caps = new Map(config.assets.map(a => [assetKey(a), a] as const));
  const recipientAllowlist = config.recipients.mode === 'allowlist' ?
    new Set(config.recipients.addresses) : null;

  return {
    async evaluate(challenge: PaymentChallenge): Promise<GateResult> {
      const req = challenge?.selectedRequirements;
      if (!req || challenge?.paymentRequired?.x402Version !== 2 ||
          req.network !== 'xrpl:0' || req.scheme !== 'exact') {
        return { allowed: false, reason: 'CPX_UNSUPPORTED_PAYMENT' };
      }
      // The XRPL x402 exact scheme requires this to be explicitly false.
      if (req.extra?.areFeesSponsored !== false &&
          !(config.legacyT54Offer === true && req.extra?.areFeesSponsored === undefined)) {
        return { allowed: false, reason: 'CPX_INVALID_FEE_TERMS' };
      }
      if (req.extra?.assetTransferMethod !== undefined &&
          !['sequence', 'ticketSequence'].includes(req.extra?.assetTransferMethod)) {
        return { allowed: false, reason: 'CPX_INVALID_TRANSFER_METHOD' };
      }
      if (!CLASSIC_ADDRESS_SHAPE.test(req.payTo ?? '')) {
        return { allowed: false, reason: 'CPX_INVALID_RECIPIENT_SHAPE' };
      }
      if (recipientAllowlist && !recipientAllowlist.has(req.payTo)) {
        return { allowed: false, reason: 'CPX_RECIPIENT_NOT_PERMITTED' };
      }
      const issuer = req.asset === 'XRP' ? undefined : req.extra?.issuer;
      // Reject inconsistent or extra issuer data for XRP.
      if (req.asset === 'XRP' && req.extra?.issuer !== undefined) {
        return { allowed: false, reason: 'CPX_UNEXPECTED_XRP_ISSUER' };
      }
      const cap = caps.get(req.asset === 'XRP' ? 'XRP' : `${req.asset}|${issuer ?? ''}`);
      if (!cap) return { allowed: false, reason: 'CPX_ASSET_NOT_PERMITTED' };
      const units = cap.kind === 'xrp' ? 'drops' : 'token';
      const maximum = cap.kind === 'xrp' ? cap.maxAmountDrops : cap.maxAmount;
      const cmp = compareAmount(req.amount, maximum, units);
      if (cmp === null || compareAmount(req.amount, '0', units) !== 1 || cmp === 1) {
        return { allowed: false, reason: 'CPX_AMOUNT_NOT_PERMITTED' };
      }
      const intent: PaymentIntent = {
        network: 'xrpl:0', asset: req.asset, amount: req.amount,
        amountUnit: units, issuer, recipient: req.payTo
      };
      if (config.approval.mode === 'callback') {
        try {
          if (!(await config.approval.authorize(intent))) {
            return { allowed: false, reason: 'CPX_PAYMENT_DENIED' };
          }
        } catch {
          return { allowed: false, reason: 'CPX_AUTHORIZATION_UNAVAILABLE' };
        }
      }
      return { allowed: true, intent };
    }
  };
}
