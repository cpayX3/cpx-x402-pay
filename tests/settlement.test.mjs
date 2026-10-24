import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyValidatedXrplSettlement} from '../dist/src/settlement_verifier.js';
const HASH='BD6B5DD6291B3683E221486CF8A85573FE1AEBB5A621358E84F9AE70B88AB973';
const INVOICE='814533B06B94B703488E7C50131221E18E5A9C36134EC963F4B649862FEC6679';
const PAYER='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const RECIPIENT='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const CURRENCY='524C555344000000000000000000000000000000';
const ISSUER='rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const amount={currency:CURRENCY,issuer:ISSUER,value:'0.005'};
const EXPECT={transactionHash:HASH,payer:PAYER,recipient:RECIPIENT,destinationTag:804681468,invoiceID:INVOICE,asset:CURRENCY,issuer:ISSUER,amount:'0.005',maxFeeDrops:'100'};
const FIXTURE={result:{hash:HASH,validated:true,ledger_index:107784657,tx_json:{TransactionType:'Payment',Account:PAYER,Destination:RECIPIENT,DestinationTag:804681468,InvoiceID:INVOICE,Fee:'12',DeliverMax:structuredClone(amount)},meta:{TransactionResult:'tesSUCCESS',delivered_amount:structuredClone(amount)}}};
const cp=() => structuredClone(FIXTURE);
test('validated exact RLUSD success from sample ledger fields',()=>{
 const rec=verifyValidatedXrplSettlement(cp(), EXPECT);
 assert.equal(rec.status,'VALIDATED_SUCCESS'); assert.equal(rec.deliveredAmount,'0.005');
});
for(const [name,mut,reason] of [
 ['not validated',r=>r.result.validated=false,'CPX_TX_NOT_VALIDATED'],
 ['missing metadata',r=>delete r.result.meta,'CPX_TX_NOT_SUCCESSFUL'],
 ['tes failure',r=>r.result.meta.TransactionResult='tecPATH_DRY','CPX_TX_NOT_SUCCESSFUL'],
 ['incorrect hash',r=>r.result.hash='A'.repeat(64),'CPX_TX_HASH_MISMATCH'],
 ['wrong account',r=>r.result.tx_json.Account='rWrong','CPX_WRONG_PAYER'],
 ['wrong recipient',r=>r.result.tx_json.Destination='rWrong','CPX_WRONG_RECIPIENT'],
 ['wrong tag',r=>r.result.tx_json.DestinationTag=804681469,'CPX_WRONG_TAG'],
 ['missing tag',r=>delete r.result.tx_json.DestinationTag,'CPX_WRONG_TAG'],
 ['wrong invoice',r=>r.result.tx_json.InvoiceID='A'.repeat(64),'CPX_WRONG_INVOICE'],
 ['excess XRP fee',r=>r.result.tx_json.Fee='101','CPX_FEE_MISMATCH'],
 ['shortfall delivery',r=>r.result.meta.delivered_amount.value='0.004','CPX_WRONG_DELIVERY'],
 ['wrong issuer',r=>r.result.meta.delivered_amount.issuer='rFake','CPX_WRONG_DELIVERY'],
 ['missing delivered field',r=>delete r.result.meta.delivered_amount,'CPX_WRONG_DELIVERY'],
 ['wrong requested amount',r=>r.result.tx_json.DeliverMax.value='0.006','CPX_WRONG_REQUEST'],
 ['no ledger index',r=>delete r.result.ledger_index,'CPX_MISSING_VALIDATED_LEDGER']
]) {
 test(`rejects ${name}`,()=>{const t=cp();mut(t);assert.throws(()=>verifyValidatedXrplSettlement(t,EXPECT),new RegExp(reason));});
}
test('XRP is checked in drops, both requested and delivered',()=>{
 const e={...EXPECT,asset:'XRP',issuer:undefined,amount:'40000'};
 const tx=cp();tx.result.tx_json.DeliverMax='40000';tx.result.meta.delivered_amount='40000';
 assert.equal(verifyValidatedXrplSettlement(tx,e).status,'VALIDATED_SUCCESS');
 tx.result.meta.delivered_amount='39999';
 assert.throws(()=>verifyValidatedXrplSettlement(tx,e),/CPX_WRONG_XRP_DELIVERY/);
});
