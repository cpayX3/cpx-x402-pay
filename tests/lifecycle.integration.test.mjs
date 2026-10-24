import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLocalAttemptJournal } from '../scripts/local-attempt-journal.mjs';
import { createJournaledSigner, executeDurablePurchase, reconcileDurablePurchase } from '../scripts/durable-purchase-lifecycle.mjs';
import { createOneShotXrplSigner } from '../dist/src/one_shot_guard.js';
import { verifyValidatedXrplSettlement } from '../dist/src/settlement_verifier.js';
const BUYER='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const SELLER='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const ISSUER='rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const ASSET='524C555344000000000000000000000000000000';
const SIGNED_HASH='BD6B5DD6291B3683E221486CF8A85573FE1AEBB5A621358E84F9AE70B88AB973';
const URL='https://seller.example.com/report';
const INVOICE='cpx_invoice_90210';
const invoiceID=createHash('sha256').update(INVOICE).digest('hex').toUpperCase();
const offer={network:'xrpl:0',scheme:'exact',payTo:SELLER,asset:ASSET,amount:'0.005',
  maxTimeoutSeconds:120,extra:{issuer:ISSUER,invoiceId:INVOICE,destinationTag:804681468,areFeesSponsored:false}};
const tx={TransactionType:'Payment',Account:BUYER,Destination:SELLER,DestinationTag:804681468,
  InvoiceID:invoiceID,Fee:'12',Sequence:123,LastLedgerSequence:100010,
  Flags:0,NetworkID:undefined,
  Amount:{currency:ASSET,issuer:ISSUER,value:'0.005'},
  SendMax:{currency:ASSET,issuer:ISSUER,value:'0.005'}};
const intentId='cpx-buyer-report-order-20261020-001';
const intent={intentId,payer:BUYER,seller:SELLER,resource:URL,asset:ASSET,amount:'0.005'};
const makeJournal = dir => createLocalAttemptJournal(dir);
const tempTest = fn => async () => {const dir=await mkdtemp(join(tmpdir(),'cpx-life-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}};
function createHarness(journal, overrides={}){
  let signCalls=0, paymentCalls=0, factoryCalls=0;
  const signer={classicAddress:BUYER,async sign(transaction){ signCalls++; if(overrides.signThrow) throw new Error('FAKE_SIGN_FAILED');
    return {signedTxBlob:'FAKE_SIGNED_BLOB',...(overrides.reportBadHash?{hash:'A'.repeat(64)}:{hash:SIGNED_HASH})};}};
  const factory=async recordingSigner=>{
    factoryCalls++;
    const guard=createOneShotXrplSigner(recordingSigner,{recipient:SELLER,asset:ASSET,issuer:ISSUER,
      exactAmount:'0.005',maxSendMax:'0.005',maxFeeDrops:'100',getValidatedLedgerIndex:async()=>100000});
    await guard.arm(offer);
    return {oneShotStatus:()=>guard.getStatus(),paidFetch:async(url)=>{
      paymentCalls++;
      if(overrides.throwBeforeSign)throw new Error('FETCH_TIMEOUT_BEFORE_SIGN');
      await guard.signer.sign({...tx});
      if(overrides.throwAfterSign)throw new Error('FETCH_TIMEOUT_AFTER_SIGN');
      return {status:200,headers:{has:()=>true}};
    }};
  };
  const run=(id=intentId)=>executeDurablePurchase({journal,intent:{...intent,intentId:id},signer,
    hashSignedTx:overrides.hashSignedTx ?? (()=>SIGNED_HASH),maxFeeDrops:'100',createPaymentClient:factory,
    reserveBudget:async()=>{},
    request:{url:URL,init:{method:'POST'}}});
  return {run,counts:()=>({signCalls,paymentCalls,factoryCalls})};
}
function ledgerFixture() {return {result:{hash:SIGNED_HASH,validated:true,ledger_index:107784657,
    tx_json:{...tx, DeliverMax:tx.Amount, Amount:undefined,NetworkID:undefined},
    meta:{TransactionResult:'tesSUCCESS',delivered_amount:tx.Amount}}};}
test('an actual one-shot guard signs once and journal records hash and receipt expectations before HTTP result', tempTest(async d=>{
  const journal=makeJournal(d),h=createHarness(journal);
  const result=await h.run();
  assert.equal(result.status,'HTTP_RESPONSE_LEDGER_UNVERIFIED');
  assert.equal(result.journalStatus,'SIGNED_SUBMISSION_UNKNOWN');
  const state=await journal.load(intentId);
  assert.equal(state.transactionHash,SIGNED_HASH);
  assert.deepEqual(state.expected,{transactionHash:SIGNED_HASH,payer:BUYER,recipient:SELLER,destinationTag:804681468,
    invoiceID,lastLedgerSequence:tx.LastLedgerSequence,asset:ASSET,issuer:ISSUER,amount:'0.005',maxFeeDrops:'100'});
  assert.deepEqual(h.counts(),{signCalls:1,paymentCalls:1,factoryCalls:1});
}));
test('restarts and repeated IDs never sign again (even when invoice changes)',tempTest(async d=>{
  const one=createHarness(makeJournal(d));await one.run();
  const other=createHarness(makeJournal(d));await assert.rejects(other.run(),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
  assert.deepEqual(other.counts(),{signCalls:0,paymentCalls:0,factoryCalls:0});
}));
test('concurrent same purchase ID admits one signing attempt',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j);
  const results=await Promise.allSettled([h.run(),h.run(),h.run(),h.run()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,3);
  assert.equal(h.counts().signCalls,1);
}));
test('timeout BEFORE signing remains reserved and cannot be retried',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j,{throwBeforeSign:true});
  await assert.rejects(h.run(),/FETCH_TIMEOUT_BEFORE_SIGN/);
  assert.equal((await j.load(intentId)).status,'RESERVED_OUTCOME_UNKNOWN');
  await assert.rejects(h.run(),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('timeout AFTER signing retains hash and blocks a second purchase',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j,{throwAfterSign:true});
  await assert.rejects(h.run(),/FETCH_TIMEOUT_AFTER_SIGN/);
  assert.equal((await j.load(intentId)).status,'SIGNED_SUBMISSION_UNKNOWN');
  await assert.rejects(h.run(),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('signer returning mismatched hash never exposes signed blob to x402',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j,{reportBadHash:true});
  await assert.rejects(h.run(),/CPX_SIGNED_HASH_MISMATCH/);
  assert.equal((await j.load(intentId)).status,'RESERVED_OUTCOME_UNKNOWN');
}));
test('signed hash persistence failure prevents handing signed blob back',tempTest(async d=>{
  const j=makeJournal(d);
  const journal={...j, signed:async()=>{throw new Error('FAKE_DISK_ERROR')}};
  const h=createHarness(journal);
  await assert.rejects(h.run(),/FAKE_DISK_ERROR/);
  assert.equal((await j.load(intentId)).status,'RESERVED_OUTCOME_UNKNOWN');
}));
test('reconciler marks validated only after strict XRPL receipt verification',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j);await h.run();
  const receipt=await reconcileDurablePurchase({journal:j,intentId,
    lookupValidatedTransaction:async hash=>{assert.equal(hash,SIGNED_HASH);return ledgerFixture()},
    verifyValidatedXrplSettlement});
  assert.equal(receipt.status,'VALIDATED_SUCCESS');
  assert.equal((await j.load(intentId)).status,'VALIDATED_SUCCESS');
  await assert.rejects(h.run(),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('unvalidated response remains blocked',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j);await h.run();
  const bad=ledgerFixture();bad.result.validated=false;
  await assert.rejects(reconcileDurablePurchase({journal:j,intentId,lookupValidatedTransaction:async()=>bad,
    verifyValidatedXrplSettlement}),/CPX_TX_NOT_VALIDATED/);
  assert.equal((await j.load(intentId)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('wrong delivered amount remains blocked',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j);await h.run();
  const bad=ledgerFixture();bad.result.meta.delivered_amount={...tx.Amount,value:'0.004'};
  await assert.rejects(reconcileDurablePurchase({journal:j,intentId,lookupValidatedTransaction:async()=>bad,
    verifyValidatedXrplSettlement}),/CPX_WRONG_DELIVERY/);
  assert.equal((await j.load(intentId)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
test('ledger lookup failure remains blocked and does not resubmit',tempTest(async d=>{
  const j=makeJournal(d),h=createHarness(j);await h.run();
  await assert.rejects(reconcileDurablePurchase({journal:j,intentId,
    lookupValidatedTransaction:async()=>{throw new Error('txnNotFound')},verifyValidatedXrplSettlement}),/txnNotFound/);
  assert.equal((await j.load(intentId)).status,'SIGNED_SUBMISSION_UNKNOWN');
  assert.equal(h.counts().signCalls,1);
}));
test('journal signer cannot be called twice, even with a fake caller',tempTest(async d=>{
  const j=makeJournal(d);
  await j.reserve(intent);
  const signer=createJournaledSigner({signer:{classicAddress:BUYER,sign:async()=>({signedTxBlob:'BLOB',hash:SIGNED_HASH})},
    journal:j,intentId,hashSignedTx:()=>SIGNED_HASH,maxFeeDrops:'100'});
  await signer.sign(tx);
  await assert.rejects(signer.sign(tx),/CPX_JOURNAL_SIGNER_ALREADY_USED/);
}));
