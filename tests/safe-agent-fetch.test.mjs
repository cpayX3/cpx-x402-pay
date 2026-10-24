import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSafeAgentFetch, validateSellerUrl, isPublicIp, resolvePublicSeller } from '../scripts/safe-agent-fetch.mjs';
const blocked = ['http://api.example.org/path','https://localhost/x','https://127.0.0.1/x',
'https://169.254.169.254/latest/meta-data','https://10.0.0.1/x','https://[::1]/x',
'https://192.168.1.2/x','https://user:pass@example.org/x','https://example.org:8443/x',
'https://example.org/x#secret','https://2130706433/x','https://0x7f000001/x',
'https://cloudpayx.example/x','https://foo.internal/x','https://example.org\\@127.0.0.1/x'];
for (const url of blocked) test('blocks seller URL '+url,()=>assert.throws(()=>validateSellerUrl(url)));
for (const ip of ['127.0.0.1','10.20.30.40','192.168.1.1','169.254.169.254','100.100.100.200',
'0.0.0.0','198.51.100.1','203.0.113.5','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])
  test('nonpublic IP rejected '+ip,()=>assert.equal(isPublicIp(ip),false));
for (const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])
  test('public IP passes '+ip,()=>assert.equal(isPublicIp(ip),true));
test('valid public seller accepted',()=>assert.equal(validateSellerUrl('https://api.cloudpayxagent.xyz/agent/ledger-status').hostname,'api.cloudpayxagent.xyz'));
test('mixed public/private DNS fails closed',async()=>assert.rejects(resolvePublicSeller('seller.com',async()=>[
 {address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]), /CPX_DNS_PRIVATE/));
test('empty DNS fails closed',async()=>assert.rejects(resolvePublicSeller('seller.com',async()=>[]), /CPX_DNS_LOOKUP_FAILED/));
test('DNS answers pin the approved public address',async()=>assert.deepEqual(await resolvePublicSeller('seller.com',async()=>[
 {address:'1.1.1.1',family:4}]),{address:'1.1.1.1',family:4}));

function fakeHttps({status=402,headers={'payment-required':'test-header'},body='{}',view}={}) {
  return (url,options,onResponse) => {
    view.url = url.toString();view.options=options;
    const client=new EventEmitter(); client.write=x=>{view.body=Buffer.from(x).toString()};
    client.end=()=>queueMicrotask(()=>{
      const incoming = new EventEmitter();
      incoming.statusCode=status; incoming.headers=headers;
      incoming.resume=()=>{};
      incoming.destroy=e=>incoming.emit('error',e);
      onResponse(incoming);
      queueMicrotask(()=>{incoming.emit('data',Buffer.from(body));incoming.emit('end');client.emit('close')});
    });
    client.destroy=e=>client.emit('error',e);
    return client;
  };
}
const resolve = async()=>[{address:'1.1.1.1',family:4}];
test('passes 402 response and preserves x402 header',async()=>{
 const view={}; const safe=createSafeAgentFetch({resolve,request:fakeHttps({view})});
 const response=await safe('https://seller.example.net/paid',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(response.status,402);assert.equal(response.headers.get('payment-required'),'test-header');
 assert.equal(view.options.lookup.length,3); assert.equal(view.body,'{}');
 await new Promise((resolve,reject)=>view.options.lookup('seller.example.net',{},(err,address,family)=>err?reject(err):
  (assert.equal(address,'1.1.1.1'),assert.equal(family,4),resolve())));
});
test('blocks HTTP redirect without sending to redirect target',async()=>{
 const view={}; const safe=createSafeAgentFetch({resolve,request:fakeHttps({status:302,headers:{location:'https://evil.example.net/'},view})});
 await assert.rejects(safe('https://seller.example.net/paid'), /CPX_HTTP_REDIRECT_BLOCKED/);
});
test('passes exact signed x402 payment header on same safe origin',async()=>{
 const view={};const safe=createSafeAgentFetch({resolve,request:fakeHttps({status:200,body:'{"ok":true}',view})});
 const response=await safe('https://seller.example.net/paid',{method:'POST',headers:{'payment-signature':'signed-proof'},body:'{}'});
 assert.equal(response.status,200);assert.equal(view.options.headers['payment-signature'],'signed-proof');
});
test('rejects oversized bodies before HTTPS request',async()=>{
 let called=false; const safe=createSafeAgentFetch({resolve,maxRequestBytes:3,request:()=>{called=true}});
 await assert.rejects(safe('https://seller.example.net/',{method:'POST',body:'hello'}),/CPX_HTTP_REQUEST_TOO_LARGE/);
 assert.equal(called,false);
});
