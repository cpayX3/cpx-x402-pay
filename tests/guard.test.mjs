import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOneShotXrplSigner } from '../dist/one_shot_guard.js';
import { CPX_XRPL_MAINNET_ASSETS } from '../dist/assets.js';
const payer = 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const recipient = 'rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const RLUSD = CPX_XRPL_MAINNET_ASSETS.RLUSD;
const usdc = CPX_XRPL_MAINNET_ASSETS.USDC;
const invoiceId = 'cpayx_test_invoice_0001';
const baseOffer = {scheme:'exact',network:'xrpl:0',payTo:recipient,amount:'0.005',asset:RLUSD.asset,maxTimeoutSeconds:120,extra:{areFeesSponsored:false,issuer:RLUSD.issuer,destinationTag:804681468,invoiceId}};
const invoiceHash = createHash('sha256').update(invoiceId).digest('hex').toUpperCase();
const baseTx = {TransactionType:'Payment',Account:payer,Destination:recipient,DestinationTag:804681468,Amount:{currency:RLUSD.asset,issuer:RLUSD.issuer,value:'0.005'},SendMax:{currency:RLUSD.asset,issuer:RLUSD.issuer,value:'0.005'},Fee:'12',Sequence:2,LastLedgerSequence:10020,Flags:0x80000000,InvoiceID:invoiceHash};
function env(change={}) {
  let count=0;
  const base={classicAddress:payer,sign:async _tx => {count++;return {signedTxBlob:'MOCK_NO_REAL_SIGNATURE'};}};
  const guard=createOneShotXrplSigner(base, {
    recipient,asset:RLUSD.asset,issuer:RLUSD.issuer,exactAmount:'0.005',maxSendMax:'0.0055',maxFeeDrops:'100',getValidatedLedgerIndex:async () => 10000,...change
  });
  return {...guard,count:()=>count};
}
test('valid transaction can be signed once after arming', async () => {
  const s=env(); await s.arm(baseOffer); const result=await s.signer.sign(baseTx);
  assert.equal(result.signedTxBlob,'MOCK_NO_REAL_SIGNATURE'); assert.equal(s.count(),1);
  await assert.rejects(s.signer.sign(baseTx), /CPX_SIGNING_NOT_AUTHORIZED/);
});
test('unarmed signer rejects without calling underlying signer', async () => {
  const s=env(); await assert.rejects(s.signer.sign(baseTx), /CPX_SIGNING_NOT_AUTHORIZED/); assert.equal(s.count(),0);
});
test('no duplicate sign even under concurrent requests', async () => {
  const s=env(); await s.arm(baseOffer);
  const results=await Promise.allSettled([s.signer.sign(baseTx),s.signer.sign(baseTx)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1); assert.equal(s.count(),1);
});
for(const [name, mutate, error] of [
  ['wrong payer',t=>t.Account='rOther','CPX_WRONG_PAYER'],
  ['changed recipient',t=>t.Destination='rEvil','CPX_WRONG_DESTINATION'],
  ['changed tag',t=>t.DestinationTag=804681469,'CPX_WRONG_DESTINATION_TAG'],
  ['missing tag',t=>delete t.DestinationTag,'CPX_WRONG_DESTINATION_TAG'],
  ['changed invoice',t=>t.InvoiceID='A'.repeat(64),'CPX_WRONG_INVOICE'],
  ['wrong currency',t=>t.Amount.currency=usdc.asset,'CPX_WRONG_ISSUED_AMOUNT'],
  ['wrong issuer',t=>t.Amount.issuer=usdc.issuer,'CPX_WRONG_ISSUED_AMOUNT'],
  ['wrong amount',t=>t.Amount.value='0.006','CPX_WRONG_ISSUED_AMOUNT'],
  ['wrong SendMax currency',t=>t.SendMax.currency=usdc.asset,'CPX_INVALID_SENDMAX'],
  ['overspend SendMax',t=>t.SendMax.value='0.0056','CPX_SENDMAX_EXCEEDS_LIMIT'],
  ['underfunded SendMax',t=>t.SendMax.value='0.004','CPX_SENDMAX_BELOW_DELIVERY'],
  ['missing SendMax',t=>delete t.SendMax,'CPX_INVALID_SENDMAX'],
  ['high fee',t=>t.Fee='101','CPX_FEE_EXCEEDS_LIMIT'],
  ['negative fee',t=>t.Fee='-3','CPX_FEE_EXCEEDS_LIMIT'],
  ['ticket transaction',t=>t.TransactionType='TicketCreate','CPX_PAYMENT_ONLY'],
  ['unknown transaction field',t=>t.SourceTag=10,'CPX_UNKNOWN_TRANSACTION_FIELD'],
  ['partial payment',t=>t.Flags=0x80020000,'CPX_FORBIDDEN_FLAGS'],
  ['missing LLS',t=>delete t.LastLedgerSequence,'CPX_EXPIRY_REQUIRED'],
  ['expiry beyond window',t=>t.LastLedgerSequence=10100,'CPX_EXPIRY_OUT_OF_RANGE'],
  ['Paths present',t=>t.Paths=[],'CPX_UNKNOWN_TRANSACTION_FIELD'],
  ['both Amount and DeliverMax',t=>t.DeliverMax=t.Amount,'CPX_EXACTLY_ONE_DELIVERY_FIELD'],
  ['delegate signing',t=>t.Delegate='rSomeone','CPX_UNKNOWN_TRANSACTION_FIELD'],
  ['memos',t=>t.Memos=[],'CPX_UNKNOWN_TRANSACTION_FIELD'],
  ['NetworkID',t=>t.NetworkID=0,'CPX_MAINNET_NETWORK_ID_FORBIDDEN']
]) {
  test(`rejects ${name}`, async () => {
    const s=env(); await s.arm(baseOffer); const tx=structuredClone(baseTx); mutate(tx);
    await assert.rejects(s.signer.sign(tx),new RegExp(error)); assert.equal(s.count(),0);
  });
}
test('official xrpl.js undefined NetworkID placeholder is omitted before signing on mainnet', async () => {
  let forwarded;
  const underlying = { classicAddress: payer, sign: async tx => {
    forwarded = tx;
    return { signedTxBlob: 'MOCK_NO_REAL_SIGNATURE' };
  }};
  const guard = createOneShotXrplSigner(underlying, {
    recipient, asset: RLUSD.asset, issuer: RLUSD.issuer,
    exactAmount: '0.005', maxSendMax: '0.0055', maxFeeDrops: '100',
    getValidatedLedgerIndex: async () => 10000
  });
  await guard.arm(baseOffer);
  const input = {...baseTx, NetworkID: undefined};
  assert.equal(Object.hasOwn(input, 'NetworkID'), true);
  await guard.signer.sign(input);
  assert.equal(Object.hasOwn(forwarded, 'NetworkID'), false);
  assert.equal(forwarded.Amount.value, '0.005');
  assert.equal(forwarded.Destination, recipient);
  assert.equal(forwarded.InvoiceID, invoiceHash);
});
for (const badNetworkID of [0, 1, 1025, null, '0']) {
  test(`rejects populated NetworkID on mainnet: ${String(badNetworkID)}`, async () => {
    const s=env();
    await s.arm(baseOffer);
    await assert.rejects(
      s.signer.sign({...baseTx, NetworkID: badNetworkID}),
      /CPX_MAINNET_NETWORK_ID_FORBIDDEN/
    );
    assert.equal(s.count(), 0);
  });
}
test('issuer and destination tag must exist in challenge',async()=>{
  const s=env(); const c=structuredClone(baseOffer); delete c.extra.destinationTag;
  await assert.rejects(s.arm(c),/CPX_DESTINATION_TAG_REQUIRED/);
});
test('challenge must include invoiceId for binding',async()=>{
  const s=env(); const c=structuredClone(baseOffer); delete c.extra.invoiceId;
  await assert.rejects(s.arm(c),/CPX_INVOICE_REQUIRED/);
});
test('forbids EVM offer and unknown issuer',async()=>{
  for(const patch of [{network:'eip155:8453'},{extra:{...baseOffer.extra,issuer:'rWrong'}}]) {
    const s=env(); await assert.rejects(s.arm({...baseOffer,...patch}),/^Error: CPX_/); assert.equal(s.count(),0);
  }
});
test('fails closed if validated ledger index cannot be checked',async()=>{
  const s=env({getValidatedLedgerIndex:async()=>{throw new Error('RPC unavailable')}});await s.arm(baseOffer);
  await assert.rejects(s.signer.sign(baseTx),/RPC unavailable/); assert.equal(s.count(),0);
});
test('can sign XRP if drops match; cannot insert SendMax',async()=>{
  const s0=env({asset:'XRP',issuer:undefined,exactAmount:'40000',maxSendMax:undefined});
  const offer={...baseOffer,asset:'XRP',amount:'40000',extra:{areFeesSponsored:false,destinationTag:804681468,invoiceId}};
  const tx={...baseTx,Amount:'40000'};delete tx.SendMax;
  await s0.arm(offer);await s0.signer.sign(tx);assert.equal(s0.count(),1);
  const s1=env({asset:'XRP',issuer:undefined,exactAmount:'40000',maxSendMax:undefined});await s1.arm(offer);
  await assert.rejects(s1.signer.sign({...tx,SendMax:'40000'}),/CPX_XRP_SENDMAX_FORBIDDEN/);
});
test('a valid USDC transaction passes with the Circle issuer', async()=>{
  let count=0;
  const s=createOneShotXrplSigner(
    {classicAddress:payer,sign:()=>{count++;return {signedTxBlob:'USDC_MOCK'};}},
    {recipient,asset:usdc.asset,issuer:usdc.issuer,exactAmount:'0.02',maxSendMax:'0.021',maxFeeDrops:'100',getValidatedLedgerIndex:async()=>10000}
  );
  await s.arm({...baseOffer,asset:usdc.asset,amount:'0.02',extra:{...baseOffer.extra,issuer:usdc.issuer}});
  await s.signer.sign({...baseTx,Amount:{currency:usdc.asset,issuer:usdc.issuer,value:'0.02'},SendMax:{currency:usdc.asset,issuer:usdc.issuer,value:'0.02'},InvoiceID:invoiceHash.toLowerCase()});
  assert.equal(count,1);
});
test('arming a second payment is forbidden', async()=>{
  const s=env();await s.arm(baseOffer);
  await assert.rejects(s.arm(baseOffer),/CPX_ALREADY_ARMED/);
});
test('a wallet sign failure still consumes the one-shot authorization',async()=>{
  let calls=0;
  const s=createOneShotXrplSigner(
    {classicAddress:payer,sign:()=>{calls++;throw new Error('Mock wallet refused');}},
    {recipient,asset:RLUSD.asset,issuer:RLUSD.issuer,exactAmount:'0.005',maxSendMax:'0.0055',maxFeeDrops:'100',getValidatedLedgerIndex:async()=>10000}
  );
  await s.arm(baseOffer);
  await assert.rejects(s.signer.sign(baseTx),/Mock wallet refused/);
  await assert.rejects(s.signer.sign(baseTx),/CPX_SIGNING_NOT_AUTHORIZED/);
  assert.equal(calls,1);
});
