import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalAttemptJournal } from '../scripts/local-attempt-journal.mjs';
import { reconcileWithLedger, queryValidatedTransaction, XRPL_MAINNET_READ_ONLY_URL, reconcileSecureNodePurchase } from '../scripts/trusted-xrpl-recovery.mjs';

const HASH='BD6B5DD6291B3683E221486CF8A85573FE1AEBB5A621358E84F9AE70B88AB973';
const PAYER='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const SELLER='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const ASSET='524C555344000000000000000000000000000000';
const ISSUER='rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const INVOICE='814533B06B94B703488E7C50131221E18E5A9C36134EC963F4B649862FEC6679';
const ID='cpx-trusted-ledger-private-test-purchase';
const intent={intentId:ID,payer:PAYER,seller:SELLER,resource:'https://example.test/paid',asset:ASSET,amount:'0.005'};
const expectTx={transactionHash:HASH,payer:PAYER,recipient:SELLER,destinationTag:804681468,invoiceID:INVOICE,asset:ASSET,issuer:ISSUER,amount:'0.005',maxFeeDrops:'100'};
const issued={currency:ASSET,issuer:ISSUER,value:'0.005'};
function transaction(){return {result:{hash:HASH,validated:true,ledger_index:107784657,
 tx_json:{TransactionType:'Payment',Account:PAYER,Destination:SELLER,DestinationTag:804681468,
 InvoiceID:INVOICE,Fee:'12',DeliverMax:{...issued}},
 meta:{TransactionResult:'tesSUCCESS',delivered_amount:{...issued}}}};}
async function journalTest(fn){const d=await mkdtemp(join(tmpdir(),'cpx-trusted-ledger-'));try{
 const journal=createLocalAttemptJournal(d);await journal.reserve(intent);await journal.signed(ID,HASH,expectTx);
 return await fn(journal,d);
}finally{await rm(d,{recursive:true,force:true})}}
function stubClient(response, calls, err) {
 return async url=>{
  calls.push({url});
  return {connect:async()=>{calls.push('connect')},request:async req=>{
    calls.push(req);if(err)throw err;return response;
   },disconnect:async()=>{calls.push('disconnect')}};
 };
}
const recover=(j,factory)=>reconcileWithLedger({journal:j,intentId:ID,makeClient:factory});

test('only a fixed official mainnet read-only node URL is passed to the client', async()=>{
 const calls=[];await queryValidatedTransaction({hash:HASH,makeClient:stubClient(transaction(),calls)});
 assert.deepEqual(calls[0],{url:XRPL_MAINNET_READ_ONLY_URL});
 assert.deepEqual(calls[2],{command:'tx',transaction:HASH,binary:false,api_version:2});
 assert.equal(calls.filter(x=>x==='disconnect').length,1);
});
test('invalid hash never constructs an XRPL client',async()=>{
 let called=false;await assert.rejects(queryValidatedTransaction({hash:'not-a-hash',makeClient:()=>{called=true}}),/CPX_RECOVERY_INVALID_HASH/);
 assert.equal(called,false);
});
test('read-only query disconnects after RPC rejection',async()=>{
 const calls=[];await assert.rejects(queryValidatedTransaction({hash:HASH,makeClient:stubClient(null,calls,new Error('txnNotFound'))}),/txnNotFound/);
 assert.equal(calls.filter(x=>x==='disconnect').length,1);
});
test('bad client fails before requesting a ledger',async()=>{
 await assert.rejects(queryValidatedTransaction({hash:HASH,makeClient:async()=>({request:async()=>{}})}),/CPX_RECOVERY_INVALID_CLIENT/);
});
test('validated correct historical payment becomes a recorded receipt',()=>journalTest(async(j,d)=>{
 const calls=[];const result=await recover(j,stubClient(transaction(),calls));
 assert.equal(result.status,'VALIDATED_SUCCESS');
 assert.equal(result.transactionHash,HASH);
 const after=await createLocalAttemptJournal(d).load(ID);
 assert.equal(after.status,'VALIDATED_SUCCESS');
 assert.deepEqual(after.verifiedReceipt,result);
 await assert.rejects(j.reserve(intent),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('ledger timeout remains signed and blocked',()=>journalTest(async j=>{
 await assert.rejects(recover(j,stubClient(null,[],new Error('TIMEOUT'))),/TIMEOUT/);
 assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
 await assert.rejects(j.reserve(intent),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('not found on this node does not imply payment failed',()=>journalTest(async j=>{
 await assert.rejects(recover(j,stubClient(null,[],new Error('txnNotFound'))),/txnNotFound/);
 assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
}));
for(const [label,modify,error] of [
 ['unvalidated',r=>{r.result.validated=false},'CPX_TX_NOT_VALIDATED'],
 ['failed transaction',r=>{r.result.meta.TransactionResult='tecPATH_DRY'},'CPX_TX_NOT_SUCCESSFUL'],
 ['wrong hash',r=>{r.result.hash='F'.repeat(64)},'CPX_TX_HASH_MISMATCH'],
 ['wrong account',r=>{r.result.tx_json.Account=SELLER},'CPX_WRONG_PAYER'],
 ['wrong recipient',r=>{r.result.tx_json.Destination=PAYER},'CPX_WRONG_RECIPIENT'],
 ['wrong tag',r=>{r.result.tx_json.DestinationTag=3},'CPX_WRONG_TAG'],
 ['wrong invoice',r=>{r.result.tx_json.InvoiceID='F'.repeat(64)},'CPX_WRONG_INVOICE'],
 ['incorrect delivered amount',r=>{r.result.meta.delivered_amount.value='0.004'},'CPX_WRONG_DELIVERY'],
 ['wrong issuer',r=>{r.result.meta.delivered_amount.issuer=SELLER},'CPX_WRONG_DELIVERY'],
 ['excess fee',r=>{r.result.tx_json.Fee='101'},'CPX_FEE_MISMATCH'],
 ['missing metadata',r=>{delete r.result.meta},'CPX_TX_NOT_SUCCESSFUL'],
]) {
 test(`${label} never writes a success journal`,()=>journalTest(async j=>{
  const r=transaction();modify(r);
  await assert.rejects(recover(j,stubClient(r,[])),new RegExp(error));
  assert.equal((await j.load(ID)).status,'SIGNED_SUBMISSION_UNKNOWN');
 }));
}
test('already validated journal is not sent for another lookup',()=>journalTest(async j=>{
 await recover(j,stubClient(transaction(),[]));let calls=0;
 await assert.rejects(recover(j,async()=>{calls++;throw Error('SHOULD_NOT_CALL')}),/CPX_RECOVERY_SIGNED_EXPECTATION_REQUIRED/);
 assert.equal(calls,0);
}));
test('unsigned journal has no recovery shortcut',async()=>{
 const d=await mkdtemp(join(tmpdir(),'cpx-unsigned-'));try{const j=createLocalAttemptJournal(d);await j.reserve(intent);
 await assert.rejects(recover(j,async()=>{throw Error('SHOULD_NOT_CONNECT')}),/CPX_RECOVERY_SIGNED_EXPECTATION_REQUIRED/);
 }finally{await rm(d,{recursive:true,force:true})}
});
test('public recovery API refuses custom ledger callbacks or URLs',async()=>{
 await assert.rejects(reconcileSecureNodePurchase({journalDir:'/tmp/test',intentId:ID,lookup:()=>transaction()}),/CPX_RECOVERY_UNSAFE_OPTION/);
 await assert.rejects(reconcileSecureNodePurchase({journalDir:'/tmp/test',intentId:ID,url:'wss:\/\/evil.test'}),/CPX_RECOVERY_UNSAFE_OPTION/);
});
