import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalAttemptJournal} from '../scripts/local-attempt-journal.mjs';
const hash='BD6B5DD6291B3683E221486CF8A85573FE1AEBB5A621358E84F9AE70B88AB973';
const args={intentId:'checkout-user-request-0000001',payer:'rBuyer',seller:'rSeller',resource:'https://example.com/report',asset:'RLUSD',amount:'0.005'};
async function withTemp(fn){const d=await mkdtemp(join(tmpdir(),'cpx-journal-test-'));try{await fn(d)}finally{await rm(d,{recursive:true,force:true})}}
test('durable reservation survives fresh process object and forbids duplicate',async()=>withTemp(async d=>{
 const one=createLocalAttemptJournal(d); await one.reserve(args);
 const two=createLocalAttemptJournal(d);
 await assert.rejects(two.reserve(args),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
 assert.equal((await two.load(args.intentId)).status,'RESERVED_OUTCOME_UNKNOWN');
}));
test('concurrent purchase attempts allow only one reservation',async()=>withTemp(async d=>{
 const journal=createLocalAttemptJournal(d);
 const settled=await Promise.allSettled(Array.from({length:8},()=>journal.reserve(args)));
 assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(settled.filter(x=>x.status==='rejected').length,7);
}));
test('signed hash recorded; verified receipt required to finalize',async()=>withTemp(async d=>{
 const j=createLocalAttemptJournal(d);await j.reserve(args);
 await j.signed(args.intentId,hash);
 await assert.rejects(j.validated(args.intentId,{status:'VALIDATED_SUCCESS',transactionHash:'A'.repeat(64),ledgerIndex:1}),/CPX_LEDGER_PROOF_REQUIRED/);
 const v=await j.validated(args.intentId,{status:'VALIDATED_SUCCESS',transactionHash:hash,ledgerIndex:107784657});
 assert.equal(v.status,'VALIDATED_SUCCESS');
 const fresh=createLocalAttemptJournal(d);
 await assert.rejects(fresh.reserve(args),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
test('unknown outcome cannot be marked verified or retried',async()=>withTemp(async d=>{
 const j=createLocalAttemptJournal(d);await j.reserve(args);
 await assert.rejects(j.validated(args.intentId,{status:'VALIDATED_SUCCESS',transactionHash:hash,ledgerIndex:100}),/CPX_LEDGER_PROOF_REQUIRED/);
 await assert.rejects(j.reserve(args),/CPX_DUPLICATE_PURCHASE_INTENT_BLOCKED/);
}));
