import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTrustedXrplPrimitives, MAINNET_LEDGER_URL} from '../scripts/trusted-xrpl-primitives.mjs';
const HASH = 'A'.repeat(64);
function xrplFixture({index=100, connectError=null, lookupError=null, hash=HASH}={}) {
  const calls=[];
  const module={
    hashes:{hashSignedTx(blob){calls.push(['hashSignedTx',blob]);return hash;}},
    Client:class {constructor(url){calls.push(['new Client',url]);}
      async connect(){calls.push('connect');if(connectError)throw connectError;}
      async getLedgerIndex(){calls.push('getLedgerIndex');if(lookupError)throw lookupError;return index;}
      async disconnect(){calls.push('disconnect');}
    }
  };
  return {calls,module};
}
test('trusted hash is computed from the signed blob using official xrpl hash utility',()=>{
  const f=xrplFixture();const p=buildTrustedXrplPrimitives(f.module);
  assert.equal(p.hashSignedTx('ABCD'),HASH);
  assert.deepEqual(f.calls,[['hashSignedTx','ABCD']]);
});
test('invalid signed blobs fail before hash call',()=>{
  const f=xrplFixture();const p=buildTrustedXrplPrimitives(f.module);
  for(const blob of ['',null,'hello','GG','A'])
    assert.throws(()=>p.hashSignedTx(blob),/CPX_SIGNED_BLOB_INVALID/);
  assert.deepEqual(f.calls,[]);
});
test('invalid official hash result fails closed',()=>{
  const f=xrplFixture({hash:'NOT_HASH'});
  assert.throws(()=>buildTrustedXrplPrimitives(f.module).hashSignedTx('ABCD'),/CPX_OFFICIAL_SIGNED_HASH_INVALID/);
});
test('getValidatedLedgerIndex queries only the fixed mainnet node and disconnects',async()=>{
  const f=xrplFixture();const p=buildTrustedXrplPrimitives(f.module);
  assert.equal(await p.getValidatedLedgerIndex(),100);
  assert.deepEqual(f.calls,[['new Client',MAINNET_LEDGER_URL],'connect','getLedgerIndex','disconnect']);
});
test('connection failure never obtains or returns a ledger index, still disconnects',async()=>{
  const f=xrplFixture({connectError:new Error('RPC_DOWN')});
  await assert.rejects(buildTrustedXrplPrimitives(f.module).getValidatedLedgerIndex(),/RPC_DOWN/);
  assert.deepEqual(f.calls,[['new Client',MAINNET_LEDGER_URL],'connect','disconnect']);
});
test('ledger lookup failure closes and rejects signing boundary',async()=>{
  const f=xrplFixture({lookupError:new Error('STALE_NODE')});
  await assert.rejects(buildTrustedXrplPrimitives(f.module).getValidatedLedgerIndex(),/STALE_NODE/);
  assert.deepEqual(f.calls,[['new Client',MAINNET_LEDGER_URL],'connect','getLedgerIndex','disconnect']);
});
test('invalid ledger index is rejected',async()=>{
  for(const index of [0,-1,'100',null,Infinity,1.25,4294967296]){
    const f=xrplFixture({index});
    await assert.rejects(buildTrustedXrplPrimitives(f.module).getValidatedLedgerIndex(),/CPX_UNTRUSTED_LEDGER_INDEX/);
    assert.equal(f.calls.at(-1),'disconnect');
  }
});
test('client library must provide both hash and ledger functions',()=>{
  assert.throws(()=>buildTrustedXrplPrimitives({}),/CPX_OFFICIAL_XRPL_LIBRARY_REQUIRED/);
  assert.throws(()=>buildTrustedXrplPrimitives(null),/CPX_OFFICIAL_XRPL_LIBRARY_REQUIRED/);
});
test('internal ledger and hash primitives are frozen',()=>{
  const p=buildTrustedXrplPrimitives(xrplFixture().module);
  assert.equal(Object.isFrozen(p),true);
  assert.throws(()=>{p.hashSignedTx=()=>HASH}, TypeError);
});
