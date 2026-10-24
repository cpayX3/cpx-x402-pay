import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAmount, createAgentPaymentGate } from '../dist/policy.js';

const recipient = 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const recipient2 = 'rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q';
const asset = '524C555344000000000000000000000000000000';
const issuer = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const getGate = (extra = {}) => createAgentPaymentGate({
  assets: [{ kind: 'issued', asset, issuer, maxAmount: '0.05' },
           { kind: 'xrp', asset: 'XRP', maxAmountDrops: '50000' }],
  recipients: { mode: 'any' },
  approval: { mode: 'autonomous' },
  ...extra
});
const challenge = (overrides = {}, extraOverrides = {}) => ({
  paymentRequired: { x402Version: 2 },
  selectedRequirements: {
    network: 'xrpl:0', scheme: 'exact', asset,
    amount: '0.02', payTo: recipient,
    extra: { areFeesSponsored: false, issuer, ...extraOverrides },
    ...overrides
  }
});

async function blocked(gate, c, reason) {
  const r = await gate.evaluate(c);
  assert.deepEqual(r, { allowed: false, reason });
}

test('unknown self-funded agent can approve a valid XRPL issued-token payment without signup', async () => {
  assert.deepEqual(await getGate().evaluate(challenge()), {
    allowed: true,
    intent: { network: 'xrpl:0', asset, issuer, amount: '0.02',
      amountUnit: 'token', recipient }
  });
});
test('different recipient permitted in opt-in open mode', async () => {
  assert.equal((await getGate().evaluate(challenge({ payTo: recipient2 }))).allowed, true);
});
test('v1 and invalid network/scheme rejected', async () => {
  await blocked(getGate(), { ...challenge(), paymentRequired: { x402Version: 1 } }, 'CPX_UNSUPPORTED_PAYMENT');
  await blocked(getGate(), challenge({ network: 'eip155:1' }), 'CPX_UNSUPPORTED_PAYMENT');
  await blocked(getGate(), challenge({ network: 'xrpl:1' }), 'CPX_UNSUPPORTED_PAYMENT');
  await blocked(getGate(), challenge({ scheme: 'upto' }), 'CPX_UNSUPPORTED_PAYMENT');
});
test('missing or sponsored fees rejected', async () => {
  await blocked(getGate(), challenge({}, { areFeesSponsored: undefined }), 'CPX_INVALID_FEE_TERMS');
  await blocked(getGate(), challenge({}, { areFeesSponsored: true }), 'CPX_INVALID_FEE_TERMS');
});
test('unknown or inconsistent transfer method rejected', async () => {
  await blocked(getGate(), challenge({}, { assetTransferMethod: 'instant' }), 'CPX_INVALID_TRANSFER_METHOD');
  assert.equal((await getGate().evaluate(challenge({}, { assetTransferMethod: 'ticketSequence' }))).allowed, true);
});
test('issuer and asset mismatch rejected', async () => {
  await blocked(getGate(), challenge({}, { issuer: recipient2 }), 'CPX_ASSET_NOT_PERMITTED');
  await blocked(getGate(), challenge({ asset: 'FAKE' }), 'CPX_ASSET_NOT_PERMITTED');
});
test('malformed address and unlisted recipient rejected', async () => {
  await blocked(getGate(), challenge({ payTo: 'not-an-XRPL-address' }), 'CPX_INVALID_RECIPIENT_SHAPE');
  await blocked(getGate({ recipients: { mode: 'allowlist', addresses: [recipient] } }), challenge({ payTo: recipient2 }), 'CPX_RECIPIENT_NOT_PERMITTED');
});
test('issued-token decimal amounts checked exactly', async () => {
  assert.equal((await getGate().evaluate(challenge({ amount: '0.0500' }))).allowed, true);
  await blocked(getGate(), challenge({ amount: '0.050000000000000000001' }), 'CPX_AMOUNT_NOT_PERMITTED');
  await blocked(getGate(), challenge({ amount: '1e-3' }), 'CPX_AMOUNT_NOT_PERMITTED');
  await blocked(getGate(), challenge({ amount: '-0.01' }), 'CPX_AMOUNT_NOT_PERMITTED');
  await blocked(getGate(), challenge({ amount: '0' }), 'CPX_AMOUNT_NOT_PERMITTED');
});
test('native XRP amount is DROPS, not 0.05 XRP', async () => {
  const xrp = challenge({ asset: 'XRP', amount: '49999' }, { issuer: undefined });
  const got = await getGate().evaluate(xrp);
  assert.equal(got.allowed, true);
  assert.equal(got.intent.amountUnit, 'drops');
  assert.equal((await getGate().evaluate(challenge({ asset: 'XRP', amount: '50000' }, { issuer: undefined }))).allowed, true);
  await blocked(getGate(), challenge({ asset: 'XRP', amount: '50001' }, { issuer: undefined }), 'CPX_AMOUNT_NOT_PERMITTED');
  await blocked(getGate(), challenge({ asset: 'XRP', amount: '0.05' }, { issuer: undefined }), 'CPX_AMOUNT_NOT_PERMITTED');
  await blocked(getGate(), challenge({ asset: 'XRP', amount: '1' }), 'CPX_UNEXPECTED_XRP_ISSUER');
});
test('independent approval callback denies an otherwise valid request', async () => {
  const gate = getGate({ approval: { mode: 'callback', authorize: async () => false } });
  await blocked(gate, challenge(), 'CPX_PAYMENT_DENIED');
});
test('callback throwing fails closed', async () => {
  const gate = getGate({ approval: { mode: 'callback', authorize: async () => { throw new Error('not available'); } } });
  await blocked(gate, challenge(), 'CPX_AUTHORIZATION_UNAVAILABLE');
});
test('config has mandatory positive caps and explicit approval/recipient policies', () => {
  assert.throws(() => getGate({ assets: [] }), /CPX_INVALID_ASSET_CAP/);
  assert.throws(() => getGate({ assets: [{ kind: 'issued', asset, issuer: 'invalid', maxAmount: '0.01' }] }), /CPX_INVALID_ASSET_DEFINITION/);
  assert.throws(() => getGate({ approval: undefined }), /CPX_APPROVAL_POLICY_REQUIRED/);
  assert.throws(() => getGate({ recipients: undefined }), /CPX_RECIPIENT_POLICY_REQUIRED/);
  assert.throws(() => getGate({ assets: [{ kind: 'xrp', asset: 'XRP', maxAmountDrops: '0' }] }), /CPX_INVALID_ASSET_CAP/);
  assert.throws(() => getGate({ recipients: { mode: 'allowlist', addresses: [] } }), /CPX_EMPTY_RECIPIENT_ALLOWLIST/);
});
test('exact comparison does not use floating point arithmetic', () => {
  assert.equal(compareAmount('0.100000000000000001', '0.1', 'token'), 1);
  assert.equal(compareAmount('1000000', '999999', 'drops'), 1);
  assert.equal(compareAmount('10.5000', '10.5', 'token'), 0);
  assert.equal(compareAmount('0.1', '1', 'drops'), null);
  assert.equal(compareAmount('1e3', '1000', 'token'), null);
});
test('fail closed on absent/malformed challenge', async () => {
  await blocked(getGate(), undefined, 'CPX_UNSUPPORTED_PAYMENT');
  await blocked(getGate(), {}, 'CPX_UNSUPPORTED_PAYMENT');
  await blocked(getGate(), { selectedRequirements: {}, paymentRequired: { x402Version: 2 } }, 'CPX_UNSUPPORTED_PAYMENT');
});
