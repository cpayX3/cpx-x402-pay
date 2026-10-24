import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAttemptJournal } from '../scripts/local-attempt-journal.mjs';
import { reconcileDurablePurchase } from '../scripts/durable-purchase-lifecycle.mjs';
import { verifyValidatedXrplSettlement } from '../dist/src/settlement_verifier.js';
const HASH='BD6B5DD6291B3683E221486CF8A85573FE1AEBB5A621358E84F9AE70B88AB973';
const BUYER='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const SELLER='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const ASSET='524C555344000000000000000000000000000000';
const ISSUER='rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const INVOICE='814533B06B94B703488E7C50131221E18E5A9C36134EC963F4B649862FEC6679';
const ID='cpx-test-recover-historical-one-purchase';
const intent={intentId:ID,payer:BUYER,seller:SELLER,resource:'https://example.test/paid',asset:ASSET,amount:'0.005'};
const expected={transactionHash:HASH,payer:BUYER,recipient:SELLER,destinationTag:804681468,
  invoiceID:INVOICE,asset:ASSET,issuer:ISSUER,amount:'0.005',maxFeeDrops:'100'};
const amount={currency:ASSET,issuer:ISSUER,value:'0.005'};
const fixture=()=>({result:{hash:HASH,validated:true,ledger_index:107784657,
  tx_json:{TransactionType:'Payment',Account:BUYER,Destination:SELLER,DestinationTag:804681468,
    InvoiceID:INVOICE,Fee:'12',DeliverMax:amount},
  meta:{TransactionResult:'tesSUCCESS',delivered_amount:amount}}});
async function withJournal(fn){const d=await mkdtemp(join(tmpdir(),'cpx-recover-test-'));try{
  const j=createLocalAttemptJournal(d);await j.reserve(intent);await j.signed(ID,HASH,expected);
  return await fn(j,d);}finally{await rm(d,{recursive:true,force:true})}}
const recover=(journal,lookup)=>reconcileDurablePurchase({journal,intentId:ID,
  lookupValidatedTransaction:lookup,verifyValidatedXrplSettlement});
test('saved signed hash reconciles a validated historical transaction',()=>withJournal(async j=>{
  const receipt=await recover(j,async h=>{assert.equal(h,HASH);return fixture()});
  assert.equal(receipt.status,'VALIDATED_SUCCESS');
  assert.equal((await j.load(ID)).status,'VALIDATED_SUCCESS');
  await assert.rejects(j.reserve(intent),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('ledger timeout retains unknown state; fresh journal object can later reconcile',()=>withJournal(async(j,d)=>{
  await assert.rejects(recover(j,async()=>{throw new Error('SIMULATED_TIMEOUT')}),/SIMULATED_TIMEOUT/);
  const reopened=createLocalAttemptJournal(d);
  assert.equal((await reopened.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
  await assert.rejects(reopened.reserve(intent),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
  await recover(reopened,async()=>fixture());
  assert.equal((await reopened.load(ID)).status,'VALIDATED_SUCCESS');
}));
test('transaction not found does NOT authorize a new payment',()=>withJournal(async j=>{
  await assert.rejects(recover(j,async()=>{throw new Error('txnNotFound')}),/txnNotFound/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('unvalidated ledger response does NOT finalize',()=>withJournal(async j=>{
  const bad=fixture();bad.result.validated=false;
  await assert.rejects(recover(j,async()=>bad),/CPX_TX_NOT_VALIDATED/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('wrong invoice stays blocked',()=>withJournal(async j=>{
  const bad=fixture();bad.result.tx_json.InvoiceID='F'.repeat(64);
  await assert.rejects(recover(j,async()=>bad),/CPX_WRONG_INVOICE/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('short-delivery stays blocked',()=>withJournal(async j=>{
  const bad=fixture();bad.result.meta.delivered_amount={...amount,value:'0.004'};
  await assert.rejects(recover(j,async()=>bad),/CPX_WRONG_DELIVERY/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('seller HTTP success is not treated as validated proof',()=>withJournal(async j=>{
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
  await assert.rejects(recover(j,async()=>({status:200,headers:{'payment-response':'present'}})),/CPX_TX_NOT_VALIDATED/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('unknown hash or wrong payer remains blocked',()=>withJournal(async j=>{
  const bad=fixture();bad.result.hash='A'.repeat(64);
  await assert.rejects(recover(j,async()=>bad),/CPX_TX_HASH_MISMATCH/);
  const badPayer=fixture();badPayer.result.tx_json.Account='rWRONG';
  await assert.rejects(recover(j,async()=>badPayer),/CPX_WRONG_PAYER/);
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
