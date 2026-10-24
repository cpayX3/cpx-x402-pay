import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentSpendingBudget, validateBudgetCaps } from '../scripts/persistent-spending-budget.mjs';
import { createLocalAttemptJournal } from '../scripts/local-attempt-journal.mjs';
import { executeDurablePurchase } from '../scripts/durable-purchase-lifecycle.mjs';
const PAYER='rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';
const SELLER='rsnHPZjBSastxz1BE38WqKBR3sgpATvreL';
const ASSET_RLUSD='524C555344000000000000000000000000000000';
const ISSUER_RLUSD='rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const ASSET_USDC='5553444300000000000000000000000000000000';
const ISSUER_USDC='rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';
const CAPS={xrpDrops:'1000',rlusd:'0.3',usdc:'2.0'};
const intent=(id,amount='0.1',asset=ASSET_RLUSD)=>({intentId:`unique-intent-test-${id}`,payer:PAYER,seller:SELLER,resource:'https://seller.example/p',asset,amount});
const tempTest=fn=>async()=>{const dir=await mkdtemp(join(tmpdir(),'cpx-budget-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}};
const reserve=(b,i,caps=CAPS,issuer=i.asset==='XRP'?undefined:ISSUER_RLUSD,maxSendMax=i.asset==='XRP'?undefined:i.amount)=>b.reserve({intent:i,issuer,caps,maxFeeDrops:'10',maxSendMax});

test('all three caps must be explicit and positive; XRP cap in drops',()=>{
  assert.equal(validateBudgetCaps(CAPS),true);
  for(const c of [undefined,{}, {...CAPS,usdc:undefined}, {...CAPS,rlusd:'0'}, {...CAPS,xrpDrops:'1.1'}, {...CAPS,rlusd:'1e3'}, {...CAPS,rlusd:'0.0000000000000001'}]) {
    assert.throws(()=>validateBudgetCaps(c),/CPX_BUDGET/);
  }
});
test('RLUSD arithmetic is exact: 0.1 + 0.2 fits 0.3',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('a','0.1')); await reserve(b,intent('b','0.2'));
  const s=await b.inspect(PAYER);
  assert.equal(s.reserved.rlusd,'300000000000000');
  assert.equal(s.reserved.xrpDrops,'20');
  await assert.rejects(reserve(b,intent('c','0.000000000000001')),/CPX_CUMULATIVE_BUDGET_EXCEEDED/);
}));
test('XRP uses integer drops and a separate cumulative cap',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('x1','680','XRP'),CAPS,undefined);
  await reserve(b,intent('x2','300','XRP'),CAPS,undefined);
  assert.equal((await b.inspect(PAYER)).reserved.xrpDrops,'1000');
  await assert.rejects(reserve(b,intent('x3','1','XRP'),CAPS,undefined),/CPX_CUMULATIVE_BUDGET_EXCEEDED/);
}));
test('Circle-issued XRPL USDC tracked separately from Ripple RLUSD',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('u1','1.25',ASSET_USDC),CAPS,ISSUER_USDC);
  await reserve(b,intent('r1','0.25'),CAPS,ISSUER_RLUSD);
  const s=await b.inspect(PAYER);
  assert.equal(s.reserved.usdc,'1250000000000000');
  assert.equal(s.reserved.xrpDrops,'20');
  assert.equal(s.reserved.rlusd,'250000000000000');
}));
test('unsupported asset or issuer refused without changing state',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await assert.rejects(reserve(b,intent('b1'),CAPS,ISSUER_USDC),/CPX_BUDGET_UNSUPPORTED_ASSET_OR_ISSUER/);
  await assert.rejects(reserve(b,intent('b2','1','ETH'),CAPS,undefined),/CPX_BUDGET_UNSUPPORTED_ASSET_OR_ISSUER/);
}));
test('same purchase ID cannot reserve budget twice',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('same'));
  await assert.rejects(reserve(b,intent('same')),/CPX_BUDGET_DUPLICATE_INTENT/);
  assert.equal((await b.inspect(PAYER)).reserved.rlusd,'100000000000000');
  assert.equal((await b.inspect(PAYER)).reserved.xrpDrops,'10');
}));
test('budget state survives a new instance after restart',tempTest(async d=>{
  await reserve(createPersistentSpendingBudget(d),intent('one','0.2'));
  await assert.rejects(reserve(createPersistentSpendingBudget(d),intent('two','0.2')), /CPX_CUMULATIVE_BUDGET_EXCEEDED/);
}));
test('config change cannot increase, reduce or reset an existing cap',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('one','0.1'));
  await assert.rejects(reserve(b,intent('two','0.1'),{...CAPS,rlusd:'10'}),/CPX_BUDGET_CAP_CHANGE_FORBIDDEN/);
  await assert.rejects(reserve(b,intent('three','0.1'),{...CAPS,rlusd:'0.2'}),/CPX_BUDGET_CAP_CHANGE_FORBIDDEN/);
  assert.equal((await b.inspect(PAYER)).reserved.rlusd,'100000000000000');
}));
test('concurrent independent intents cannot exceed a shared wallet cap',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  const replies=await Promise.allSettled(Array.from({length:12},(_,i)=>reserve(b,intent(i,'0.2'))));
  assert.equal(replies.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await b.inspect(PAYER)).reserved.rlusd,'200000000000000');
}));
test('an abandoned cross-process budget lock fails closed',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('one','0.1'));
  const {readdir} = await import('node:fs/promises');
  const folder=join(d,'.cpx-spending-budget');
  const file=(await readdir(folder)).find(x=>x.endsWith('.json'));
  await writeFile(join(folder,file+'.lock'),'orphan');
  await assert.rejects(reserve(b,intent('two','0.1')),/CPX_BUDGET_LOCKED_FAIL_CLOSED/);
}));
test('corrupted wallet budget record fails closed',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await reserve(b,intent('one','0.1'));
  const {readdir} = await import('node:fs/promises');
  const folder=join(d,'.cpx-spending-budget');
  const file=(await readdir(folder)).find(x=>x.endsWith('.json'));
  await writeFile(join(folder,file),'garbled');
  await assert.rejects(reserve(b,intent('two','0.1')), /Unexpected token|not valid JSON/);
}));
test('storage must not be group/world accessible',tempTest(async d=>{
  const publicDir=join(d,'public');
  await mkdir(publicDir,{mode:0o777});
  const {chmod}=await import('node:fs/promises');
  await chmod(publicDir,0o777);
  await assert.rejects(reserve(createPersistentSpendingBudget(publicDir),intent('open')), /CPX_BUDGET_STORAGE_NOT_PRIVATE/);
}));
test('fails closed for positive amount above budget on first purchase',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await assert.rejects(reserve(b,intent('huge','0.301')),/CPX_CUMULATIVE_BUDGET_EXCEEDED/);
}));
test('budget reservation is mandatory before payment client exists',tempTest(async d=>{
  const journal=createLocalAttemptJournal(d);
  let factoryCalls=0;
  const i=intent('integration','0.1');
  const options={journal,intent:i,signer:{classicAddress:PAYER,sign:()=>{throw Error('SIGNING_MUST_NOT_OCCUR')}},
    hashSignedTx:()=>{throw Error('HASH_MUST_NOT_OCCUR')},maxFeeDrops:'100',
    request:{url:i.resource,init:{method:'POST'}},
    createPaymentClient:()=>{factoryCalls++;return {oneShotStatus:()=>({}),paidFetch:async()=>({status:200,headers:{has:()=>false}})};}};
  await assert.rejects(executeDurablePurchase(options),/CPX_BUDGET_RESERVATION_REQUIRED/);
  assert.equal(factoryCalls,0);
  await assert.rejects(executeDurablePurchase({...options,intent:intent('integration2','0.1'),
    reserveBudget:async()=>{throw Error('BUDGET_DENIED')}}),/BUDGET_DENIED/);
  assert.equal(factoryCalls,0);
}));
test('budget reservation occurs before any HTTP attempt',tempTest(async d=>{
  const journal=createLocalAttemptJournal(d);
  const b=createPersistentSpendingBudget(d);
  const i=intent('integration3','0.1');
  const output=await executeDurablePurchase({journal,intent:i,
    signer:{classicAddress:PAYER,sign:()=>{throw Error('NOT_SIGNING')}},
    hashSignedTx:()=>{throw Error('NOT_HASHING')},maxFeeDrops:'100',
    reserveBudget:async intentToReserve => reserve(b,intentToReserve),
    createPaymentClient:()=>({oneShotStatus:()=>({}),paidFetch:async()=>{
      assert.equal((await b.inspect(PAYER)).reserved.rlusd,'100000000000000');
      return {status:200,headers:{has:()=>false}};
    }}),request:{url:i.resource,init:{method:'POST'}}});
  assert.equal(output.status,'HTTP_RESPONSE_LEDGER_UNVERIFIED');
  assert.equal((await journal.load(i.intentId)).status,'RESERVED_OUTCOME_UNKNOWN');
}));

test('issued-token budget reserves SendMax exposure, not merely delivered amount',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await b.reserve({intent:intent('max1','0.1'),issuer:ISSUER_RLUSD,caps:CAPS,maxFeeDrops:'10',maxSendMax:'0.2'});
  assert.equal((await b.inspect(PAYER)).reserved.rlusd,'200000000000000');
  await assert.rejects(b.reserve({intent:intent('max2','0.15'),issuer:ISSUER_RLUSD,caps:CAPS,maxFeeDrops:'10',maxSendMax:'0.15'}),/CPX_CUMULATIVE_BUDGET_EXCEEDED/);
}));
test('stablecoin transactions also consume worst-case XRP network fee budget',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  const limited={...CAPS,xrpDrops:'15'};
  await reserve(b,intent('fee1','0.1'),limited);
  await assert.rejects(reserve(b,intent('fee2','0.1'),limited),/CPX_CUMULATIVE_BUDGET_EXCEEDED/);
  assert.equal((await b.inspect(PAYER)).reserved.xrpDrops,'10');
}));
test('rejects insufficient SendMax and unspecified fee caps',tempTest(async d=>{
  const b=createPersistentSpendingBudget(d);
  await assert.rejects(b.reserve({intent:intent('lowmax','0.1'),issuer:ISSUER_RLUSD,caps:CAPS,maxFeeDrops:'10',maxSendMax:'0.09'}),/CPX_BUDGET_SENDMAX_BELOW_DELIVERY/);
  await assert.rejects(b.reserve({intent:intent('nofee','0.1'),issuer:ISSUER_RLUSD,caps:CAPS,maxSendMax:'0.1'}),/CPX_BUDGET_AMOUNT_INVALID/);
}));
