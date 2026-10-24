import test from 'node:test';
import assert from 'node:assert/strict';
import { CPX_XRPL_MAINNET_ASSETS as ASSETS, createThreeAssetPolicy } from '../dist/assets.js';
import { createAgentPaymentGate } from '../dist/policy.js';

const DEST = 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const OTHER_DEST = 'rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q';
const defaultLimits = Object.freeze({ xrpDrops: '50000', rlusd: '0.05', usdc: '0.07' });
const gate = (opt={}) => createAgentPaymentGate(createThreeAssetPolicy({
  limits: { ...defaultLimits },
  recipients: { mode: 'any' },
  approval: { mode: 'autonomous' },
  ...opt
}));
const challenge = (asset, amount, modifications={}) => ({
  paymentRequired: { x402Version: 2 },
  selectedRequirements: {
    network: 'xrpl:0', scheme: 'exact',
    asset: asset.asset, amount, payTo: DEST,
    extra: { areFeesSponsored: false, ...('issuer' in asset ? { issuer: asset.issuer } : {}), ...modifications.extra },
    ...Object.fromEntries(Object.entries(modifications).filter(([k]) => k !== 'extra'))
  }
});
async function allows(g, c, expectedUnits) {
  const result = await g.evaluate(c);
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.equal(result.intent.amountUnit, expectedUnits);
  return result;
}
async function denies(g, c, reason) {
  assert.deepEqual(await g.evaluate(c), { allowed: false, reason });
}

test('published XRPL identifiers: XRP, Ripple RLUSD, Circle USDC, all xrpl:0', () => {
  assert.equal(ASSETS.XRP.asset, 'XRP');
  assert.equal(ASSETS.RLUSD.asset, '524C555344000000000000000000000000000000');
  assert.equal(ASSETS.RLUSD.issuer, 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De');
  assert.equal(ASSETS.USDC.asset, '5553444300000000000000000000000000000000');
  assert.equal(ASSETS.USDC.issuer, 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE');
  for (const asset of Object.values(ASSETS)) assert.equal(asset.network, 'xrpl:0');
});
test('all three assets accepted, no registration or payee preapproval required', async () => {
  await allows(gate(), challenge(ASSETS.XRP, '35000'), 'drops');
  await allows(gate(), challenge(ASSETS.RLUSD, '0.015'), 'token');
  await allows(gate(), challenge(ASSETS.USDC, '0.065'), 'token');
  await allows(gate(), challenge(ASSETS.USDC, '0.02', { payTo: OTHER_DEST }), 'token');
});
test('maximum is independent per asset', async () => {
  const g = gate();
  await allows(g, challenge(ASSETS.XRP, '50000'), 'drops');
  await allows(g, challenge(ASSETS.RLUSD, '0.05'), 'token');
  await allows(g, challenge(ASSETS.USDC, '0.07'), 'token');
  await denies(g, challenge(ASSETS.XRP, '50001'), 'CPX_AMOUNT_NOT_PERMITTED');
  await denies(g, challenge(ASSETS.RLUSD, '0.050000001'), 'CPX_AMOUNT_NOT_PERMITTED');
  await denies(g, challenge(ASSETS.USDC, '0.0700000000001'), 'CPX_AMOUNT_NOT_PERMITTED');
});
test('XRP amount is drops; decimals and zero are rejected', async () => {
  await denies(gate(), challenge(ASSETS.XRP, '0.05'), 'CPX_AMOUNT_NOT_PERMITTED');
  await denies(gate(), challenge(ASSETS.XRP, '0'), 'CPX_AMOUNT_NOT_PERMITTED');
  await allows(gate(), challenge(ASSETS.XRP, '1'), 'drops');
});
test('RLUSD and USDC amounts are decimal token units', async () => {
  await allows(gate(), challenge(ASSETS.RLUSD, '0.0500'), 'token');
  await allows(gate(), challenge(ASSETS.USDC, '0.07000'), 'token');
  await denies(gate(), challenge(ASSETS.RLUSD, '5e-2'), 'CPX_AMOUNT_NOT_PERMITTED');
  await denies(gate(), challenge(ASSETS.USDC, '-0.01'), 'CPX_AMOUNT_NOT_PERMITTED');
});
test('spoofed RLUSD issuer not accepted even if token name matches', async () => {
  await denies(gate(), challenge(ASSETS.RLUSD, '0.01', {extra: {issuer: ASSETS.USDC.issuer}}), 'CPX_ASSET_NOT_PERMITTED');
});
test('spoofed USDC issuer not accepted even if token name matches', async () => {
  await denies(gate(), challenge(ASSETS.USDC, '0.01', {extra: {issuer: ASSETS.RLUSD.issuer}}), 'CPX_ASSET_NOT_PERMITTED');
});
test('lookalike and non-XRPL assets not accepted', async () => {
  const g = gate();
  await denies(g, challenge({asset:'USDC',issuer:ASSETS.USDC.issuer},'0.01'), 'CPX_ASSET_NOT_PERMITTED');
  await denies(g, challenge({asset:'USD',issuer:ASSETS.USDC.issuer},'0.01'), 'CPX_ASSET_NOT_PERMITTED');
  await denies(g, challenge({asset:'RLUSD',issuer:ASSETS.RLUSD.issuer},'0.01'), 'CPX_ASSET_NOT_PERMITTED');
  await denies(g, challenge(ASSETS.USDC,'0.01',{network:'eip155:8453'}), 'CPX_UNSUPPORTED_PAYMENT');
  await denies(g, challenge(ASSETS.USDC,'0.01',{network:'xrpl:1'}), 'CPX_UNSUPPORTED_PAYMENT');
});
test('unapproved recipients rejected when opted into allowlist mode', async () => {
  const g = gate({recipients: {mode:'allowlist', addresses: [DEST]}});
  await allows(g, challenge(ASSETS.RLUSD,'0.01'), 'token');
  await denies(g, challenge(ASSETS.RLUSD,'0.01',{payTo: OTHER_DEST}), 'CPX_RECIPIENT_NOT_PERMITTED');
});
test('issuer extra cannot be attached to XRP', async () => {
  await denies(gate(), challenge(ASSETS.XRP, '1', {extra:{issuer:ASSETS.RLUSD.issuer}}), 'CPX_UNEXPECTED_XRP_ISSUER');
});
test('fee sponsorship not supported for any of the three assets', async () => {
  for (const token of Object.values(ASSETS)) {
    await denies(gate(), challenge(token,'1',{extra:{areFeesSponsored:true}}),'CPX_INVALID_FEE_TERMS');
    await denies(gate(), challenge(token,'1',{extra:{areFeesSponsored:undefined}}),'CPX_INVALID_FEE_TERMS');
  }
});
test('every asset must be explicitly capped above zero', () => {
  for (const field of ['xrpDrops','rlusd','usdc']) {
    assert.throws(() => gate({limits:{...defaultLimits,[field]:'0'}}), /CPX_INVALID_ASSET_CAP/);
  }
  assert.throws(() => gate({limits:{...defaultLimits,usdc:'unlimited'}}), /CPX_INVALID_ASSET_CAP/);
  assert.throws(() => createThreeAssetPolicy({recipients:{mode:'any'},approval:{mode:'autonomous'}}), /CPX_THREE_ASSET_LIMITS_REQUIRED/);
});
test('policy requires explicit autonomous authorization opt-in, not implicit', () => {
  assert.throws(() => gate({approval:undefined}), /CPX_APPROVAL_POLICY_REQUIRED/);
});
test('operator callback can veto a valid USDC purchase', async () => {
  await denies(gate({approval:{mode:'callback',authorize:async intent => intent.asset !== ASSETS.USDC.asset}}),challenge(ASSETS.USDC,'0.01'),'CPX_PAYMENT_DENIED');
});
test('unsupported x402 envelope is denied on all 3 assets', async () => {
  for (const token of Object.values(ASSETS)) {
    const c = challenge(token, '1'); c.paymentRequired.x402Version = 1;
    await denies(gate(), c, 'CPX_UNSUPPORTED_PAYMENT');
  }
});
