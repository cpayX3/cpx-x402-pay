import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOneShotXrplSigner} from '../dist/src/one_shot_guard.js';
import {createAgentPaymentGate} from '../dist/src/policy.js';
import {verifyValidatedXrplSettlement} from '../dist/src/settlement_verifier.js';
const buyer='rBZpuNToTKzUF2fkxWcWw5WLoP41eQQXLm';
const seller='rKxTzCKYKPPdXEzuioEQ6KekQK26w2DBd5';
const quote={scheme:'exact',network:'xrpl:0',asset:'XRP',amount:'73136',payTo:seller,maxTimeoutSeconds:600,
 extra:{sourceTag:804681468,invoiceId:'5DD0EB76AF474238B29D06107A31471D'}};
const invoice=createHash('sha256').update(quote.extra.invoiceId).digest('hex').toUpperCase();
const tx={TransactionType:'Payment',Account:buyer,Destination:seller,Amount:'73136',Fee:'12',Sequence:202,LastLedgerSequence:10020,InvoiceID:invoice};
const signer=(opts={})=>{
 let signed=[];const s=createOneShotXrplSigner({classicAddress:buyer,sign:x=>{signed.push(x);return {signedTxBlob:'NO_REAL_SIGNATURE'};}},{recipient:seller,asset:'XRP',exactAmount:'73136',maxFeeDrops:'100',getValidatedLedgerIndex:async()=>10000,...opts});
 return {...s,signed};
};
test('strict mode still rejects t54 absence of fee sponsorship flag',async()=>{
 const s=signer();await assert.rejects(s.arm(quote),/CPX_NOT_XRPL_EXACT/);assert.equal(s.signed.length,0);
});
test('opt-in signs identical XRP amount, recipient, invoice and fixed sourceTag',async()=>{
 const s=signer({legacyT54Offer:true});await s.arm(quote);
 await s.signer.sign({...tx,NetworkID:undefined});
 assert.equal(s.signed.length,1);
 assert.equal(s.signed[0].SourceTag,804681468);
 assert.equal(s.signed[0].DestinationTag,undefined);
 assert.equal(s.signed[0].InvoiceID,invoice);
 assert.equal(Object.hasOwn(s.signed[0],'NetworkID'),false);
});
test('opt-in rejects malicious SourceTag override',async()=>{
 const s=signer({legacyT54Offer:true});await s.arm(quote);
 await assert.rejects(s.signer.sign({...tx,SourceTag:42}),/CPX_WRONG_SOURCE_TAG/);
 assert.equal(s.signed.length,0);
});
test('opt-in rejects changed amount without accessing real signer',async()=>{
 const s=signer({legacyT54Offer:true});await s.arm(quote);
 await assert.rejects(s.signer.sign({...tx,Amount:'73137'}),/CPX_WRONG_XRP_AMOUNT/);
 assert.equal(s.signed.length,0);
});
test('opt-in forbids sponsored fee offers and wrong network',async()=>{
 for(const req of [{...quote,extra:{...quote.extra,areFeesSponsored:true}}, {...quote,network:'eip155:8453'}]){
  const s=signer({legacyT54Offer:true});await assert.rejects(s.arm(req),/CPX_NOT_XRPL_EXACT/);
 }
});
test('policy accepts missing fee flag only when explicitly enabled and never Base',async()=>{
 const conf={assets:[{kind:'xrp',asset:'XRP',maxAmountDrops:'73136'}],recipients:{mode:'allowlist',addresses:[seller]},approval:{mode:'autonomous'}};
 const strict=createAgentPaymentGate(conf);
 assert.deepEqual(await strict.evaluate({paymentRequired:{x402Version:2},selectedRequirements:quote}),{allowed:false,reason:'CPX_INVALID_FEE_TERMS'});
 const legacy=createAgentPaymentGate({...conf,legacyT54Offer:true});
 assert.equal((await legacy.evaluate({paymentRequired:{x402Version:2},selectedRequirements:quote})).allowed,true);
 assert.equal((await legacy.evaluate({paymentRequired:{x402Version:2},selectedRequirements:{...quote,network:'eip155:8453'}})).allowed,false);
});
test('ledger receipt with bounded SourceTag and no DestinationTag verifies, wrong tag fails',()=>{
 const hash='A'.repeat(64);
 const expected={transactionHash:hash,payer:buyer,recipient:seller,sourceTag:804681468,invoiceID:invoice,asset:'XRP',amount:'73136',maxFeeDrops:'100'};
 const record={result:{hash,validated:true,ledger_index:107785000,meta:{TransactionResult:'tesSUCCESS',delivered_amount:'73136'},tx_json:{...tx,SourceTag:804681468}}};
 assert.equal(verifyValidatedXrplSettlement(record,expected).status,'VALIDATED_SUCCESS');
 record.result.tx_json.SourceTag=21;
 assert.throws(()=>verifyValidatedXrplSettlement(record,expected),/CPX_WRONG_SOURCE_TAG/);
});
