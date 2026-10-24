import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecureNodePurchase } from '../scripts/secure-node-purchase.mjs';
const url='https://api.cloudpayxagent.xyz/agent/ledger-status';
const payer='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const seller='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const asset='524C555344000000000000000000000000000000';
function fixture(){return {
 intent:{intentId:'stable-purchase-id-2026-001',payer,seller,resource:url,asset,amount:'0.005'},
 journalDir:'/tmp/cpx-secure-entry-test', budgetCaps:{xrpDrops:'1000000',rlusd:'2',usdc:'2'},
 signer:{classicAddress:payer,sign:()=>{throw Error('NO_SIGNING');}},
 policy:{limits:{}},
 oneShot:{recipient:seller,asset,issuer:'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
   exactAmount:'0.005',maxSendMax:'0.005',maxFeeDrops:'100'},
 maxFeeDrops:'100', request:{url,init:{method:'POST',body:'{}'}}, timeoutMs:20000
};}
test('accepts a locked, durable, guarded Node purchase configuration',()=>assert.equal(validateSecureNodePurchase(fixture()),true));
test('refuses opt-out of safe HTTP transport',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),requestFetch:fetch}),/CPX_UNSAFE_OPTION_FORBIDDEN/));
test('refuses injected createPaymentClient',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),createPaymentClient:()=>{}}),/CPX_UNSAFE_OPTION_FORBIDDEN/));
test('refuses to run without a durable journal path',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),journalDir:''}),/CPX_DURABLE_JOURNAL_PATH_REQUIRED/));
test('refuses to run without one-shot signing guard',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),oneShot:undefined}),/CPX_ONE_SHOT_INTENT_MISMATCH/));
test('refuses payer/signer mismatch',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),signer:{classicAddress:seller,sign:()=>{}}}),/CPX_WRONG_OR_MISSING_PAYER_SIGNER/));
test('refuses seller/one-shot mismatch',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),oneShot:{...fixture().oneShot,recipient:payer}}),/CPX_ONE_SHOT_INTENT_MISMATCH/));
test('refuses mismatched amount',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),intent:{...fixture().intent,amount:'0.01'}}),/CPX_ONE_SHOT_INTENT_MISMATCH/));
test('refuses a mismatched fee ceiling',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),oneShot:{...fixture().oneShot,maxFeeDrops:'200'}}),/CPX_FEE_CEILING_MISMATCH/));
test('refuses nonpublic URL before attempting purchase',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),intent:{...fixture().intent,resource:'https://127.0.0.1/secret'}}),/CPX_PRIVATE_NETWORK_BLOCKED/));
test('refuses a resource that differs from economic intent',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),request:{url:'https://other.example.com',init:{method:'POST',body:'{}'}}}),/CPX_RESOURCE_MISMATCH/));
test('refuses unsigned HTTP method',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),request:{url,init:{method:'GET',body:'{}'}}}),/CPX_POST_REQUIRED/));
test('refuses credential-bearing first requests',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),request:{url,init:{method:'POST',body:'{}',headers:{Authorization:'Bearer wrong'}}}}),/CPX_CREDENTIALS_IN_INITIAL_REQUEST_FORBIDDEN/));
test('refuses shipping client-supplied payment proof',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),request:{url,init:{method:'POST',body:'{}',headers:{'payment-signature':'secret'}}}}),/CPX_CREDENTIALS_IN_INITIAL_REQUEST_FORBIDDEN/));
test('refuses caller-provided hash callback',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),hashSignedTx:()=> 'F'.repeat(64)}),/CPX_UNSAFE_OPTION_FORBIDDEN/));
test('refuses caller-provided ledger index callback',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),oneShot:{...fixture().oneShot,getValidatedLedgerIndex:async()=>123}}),/CPX_ONE_SHOT_INTENT_MISMATCH/));

test('requires persistent aggregate budget configuration',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),budgetCaps:undefined}),/CPX_BUDGET_CAPS_REQUIRED/));
test('rejects unlimited or zero budget',()=>assert.throws(()=>validateSecureNodePurchase({...fixture(),budgetCaps:{xrpDrops:'1000',rlusd:'0',usdc:'2'}}),/CPX_BUDGET_CAP_MUST_BE_POSITIVE/));
