import { validateSecureNodePurchase } from '@cloudpayx/x402-pay';

// Example-only addresses. No real wallet or signing credentials.
const payer = 'r' + 'A'.repeat(25);
const seller = 'r' + 'B'.repeat(25);
const resource = 'https://example.com/paid-resource';

const purchase = {
  intent: {
    intentId: 'cpx-quickstart-0001',
    payer,
    seller,
    resource,
    asset: 'XRP',
    amount: '1000' // XRP amounts are in drops
  },
  journalDir: './cpx-quickstart-journal',
  budgetCaps: {
    xrpDrops: '1000000',
    rlusd: '2',
    usdc: '2'
  },
  signer: {
    classicAddress: payer,
    sign: async () => {
      throw new Error('DEMO_SIGNING_DISABLED');
    }
  },
  policy: {
    assets: [{
      kind: 'xrp',
      asset: 'XRP',
      maxAmountDrops: '1000'
    }],
    recipients: {
      mode: 'allowlist',
      addresses: [seller]
    },
    approval: {
      mode: 'callback',
      authorize: async () => false
    }
  },
  oneShot: {
    recipient: seller,
    asset: 'XRP',
    exactAmount: '1000',
    maxFeeDrops: '100'
  },
  maxFeeDrops: '100',
  request: {
    url: resource,
    init: {
      method: 'POST',
      body: '{}'
    }
  }
};

const valid = validateSecureNodePurchase(purchase);

console.log('cpX x402 Pay');
console.log('Configuration valid:', valid);
console.log('No wallet connected. No transaction signed or submitted.');
console.log('This checks configuration shape, not payment authorization or settlement.');
