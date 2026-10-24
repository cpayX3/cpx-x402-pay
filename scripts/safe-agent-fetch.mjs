/**
 * cpX x402 Pay - Node.js HTTPS-only agent request transport.
 * Protects agent-side buyer requests to seller resources with public-only,
 * pinned DNS resolution and no redirect following. No XRPL signing here.
 * IMPORTANT: Node.js adapter; browser runtimes need a separate transport.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP, BlockList } from 'node:net';

const BLOCKED = new BlockList();
for (const [ip,bits] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10],
  ['127.0.0.0',8], ['169.254.0.0',16], ['172.16.0.0',12],
  ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24],
  ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24],
  ['203.0.113.0',24], ['224.0.0.0',4], ['240.0.0.0',4]
]) BLOCKED.addSubnet(ip,bits,'ipv4');
for (const [ip,bits] of [
  ['::',128], ['::1',128],
  ['64:ff9b::',96], ['64:ff9b:1::',48], ['100::',64],
  ['2001::',23], ['2001:db8::',32], ['2002::',16],
  ['fc00::',7], ['fe80::',10], ['ff00::',8]
]) BLOCKED.addSubnet(ip,bits,'ipv6');

function deny(code) { throw new Error(code); }

/** Conservative public-address check. Rejects atypical IPv6 routing schemes. */
export function isPublicIp(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) return false;
  if (BLOCKED.check(address, family===4?'ipv4':'ipv6')) return false;
  if (family===6) {
    // IPv6 global unicast: 2000::/3 only, as a conservative baseline.
    const first = parseInt(address.split(':')[0] || '0',16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
  }
  return true;
}

export function validateSellerUrl(input) {
  // Disallow backslashes before URL normalization (WHATWG treats them as slashes).
  if (String(input).includes('\\')) deny('CPX_INVALID_SELLER_URL');
  let url;
  try { url = new URL(String(input)); }
  catch { return deny('CPX_INVALID_SELLER_URL'); }
  if (url.protocol !== 'https:') deny('CPX_HTTPS_REQUIRED');
  if (url.port && url.port !== '443') deny('CPX_NONSTANDARD_PORT_BLOCKED');
  if (url.username || url.password) deny('CPX_URL_CREDENTIALS_BLOCKED');
  if (url.hash) deny('CPX_URL_FRAGMENT_BLOCKED');
  const host = url.hostname.toLowerCase().replace(/\.$/,'');
  if (!host || host.length > 253 || host.includes('%') || host.includes('\\')) deny('CPX_INVALID_SELLER_HOST');
  const isIpHost = isIP(host.replace(/^\[|\]$/g,''));
  if (isIpHost) {
    if (!isPublicIp(host.replace(/^\[|\]$/g,''))) deny('CPX_PRIVATE_NETWORK_BLOCKED');
  } else {
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') ||
      host.split('.').some(p => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-')))
      deny('CPX_INVALID_SELLER_HOST');
    if (/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
      host.endsWith('.home.arpa') || host.endsWith('.arpa')) deny('CPX_PRIVATE_HOST_BLOCKED');
  }
  // Constructed Request/URL normalizes alternate IPv4 encodings to dotted-quad.
  return url;
}

/** Resolve once, reject ANY non-public DNS answers, pin the chosen answer at socket connect. */
export async function resolvePublicSeller(hostname, resolve = dnsLookup) {
  const host = hostname.replace(/^\[|\]$/g,'');
  const family = isIP(host);
  if (family) {
    if (!isPublicIp(host)) deny('CPX_PRIVATE_NETWORK_BLOCKED');
    return {address:host,family};
  }
  let answers;
  try { answers = await resolve(host, {all:true,verbatim:true}); }
  catch { return deny('CPX_DNS_LOOKUP_FAILED'); }
  if (!Array.isArray(answers) || !answers.length) deny('CPX_DNS_LOOKUP_FAILED');
  if (!answers.every(item => item && item.family === isIP(item.address) && isPublicIp(item.address)))
    deny('CPX_DNS_PRIVATE_OR_UNROUTABLE_ADDRESS');
  return {address:answers[0].address, family:answers[0].family};
}

function getTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60000) deny('CPX_INVALID_HTTP_TIMEOUT');
  return value;
}

/**
 * Explicit Node-only opt-in transport for SDK requestFetch. No redirects or
 * browser cookies. Uses the SAME approved DNS address for the actual TLS socket.
 * The caller decides which seller URL to request; no merchant registration.
 */
export function createSafeAgentFetch({
  resolve = dnsLookup,
  request = httpsRequest,
  timeoutMs = 15000,
  maxRequestBytes = 256 * 1024,
  maxResponseBytes = 8 * 1024 * 1024
} = {}) {
  getTimeout(timeoutMs);
  if (![maxRequestBytes,maxResponseBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32*1024*1024))
    deny('CPX_INVALID_HTTP_BODY_LIMIT');
  return async function safeAgentFetch(input, init = {}) {
    // Constructing Request preserves x402's method, headers and body on the retry.
    validateSellerUrl(input instanceof Request ? input.url : input);
    const req = new Request(input, init);
    const url = validateSellerUrl(req.url);
    const pinned = await resolvePublicSeller(url.hostname,resolve);
    if (req.signal.aborted) deny('CPX_HTTP_ABORTED');
    const bytes = req.body ? Buffer.from(await req.arrayBuffer()) : Buffer.alloc(0);
    if (bytes.length > maxRequestBytes) deny('CPX_HTTP_REQUEST_TOO_LARGE');
    const headers = Object.fromEntries(req.headers);
    // Node fetch adds implicit Accept-Encoding but https.request doesn't; avoid
    // transparent decompression ambiguity and keep the response byte limit real.
    headers['accept-encoding'] = 'identity';
    headers['content-length'] = String(bytes.length);
    return await new Promise((resolvePromise,rejectPromise) => {
      let settled = false;
      let signalHandler;
      let deadline;
      const reject = err => { if (!settled) { settled = true; clearTimeout(deadline); rejectPromise(err); } };
      const finish = val => { if (!settled) { settled = true; clearTimeout(deadline); resolvePromise(val); } };
      const requestOptions = {
        method:req.method,headers,
        timeout:timeoutMs,
        autoSelectFamily:false,
        // TLS certificate validation and SNI use the *original hostname*.
        // Only the DNS address is pinned, avoiding DNS-rebinding after checks.
        lookup(host, opts, callback) {
          if (host.toLowerCase().replace(/\.$/,'') !== url.hostname.toLowerCase().replace(/\.$/,''))
            return callback(new Error('CPX_DNS_HOST_MISMATCH'));
          if (opts?.all) return callback(null, [{...pinned}]);
          callback(null, pinned.address, pinned.family);
        }
      };
      let client;
      try {
        client = request(url, requestOptions, incoming => {
          const code = incoming.statusCode ?? 0;
          // NEVER follow 3xx, even on a paid x402 retry.
          if (code >= 300 && code < 400) {
            incoming.resume();
            return reject(new Error('CPX_HTTP_REDIRECT_BLOCKED'));
          }
          if (code < 200 || code > 599) {
            incoming.resume();
            return reject(new Error('CPX_BAD_HTTP_STATUS'));
          }
          let total = 0; const chunks=[];
          incoming.on('data', chunk => {
            total += chunk.length;
            if (total > maxResponseBytes) {
              incoming.destroy(new Error('CPX_HTTP_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on('error',reject);
          incoming.on('end',()=>{
            try {
              const responseHeaders = new Headers();
              for (const [name,value] of Object.entries(incoming.headers)) {
                if (value !== undefined) responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
              }
              const body = [204,205,304].includes(code)?null:Buffer.concat(chunks);
              finish(new Response(body,{status:code,headers:responseHeaders}));
            } catch(e) { reject(e); }
          });
        });
      } catch(e) { return reject(e); }
      deadline = setTimeout(()=>client.destroy(new Error('CPX_HTTP_TIMEOUT')),timeoutMs);
      deadline.unref?.();
      client.on('timeout',()=>client.destroy(new Error('CPX_HTTP_TIMEOUT')));
      client.on('error',reject);
      signalHandler = () => client.destroy(new Error('CPX_HTTP_ABORTED'));
      req.signal.addEventListener('abort',signalHandler,{once:true});
      client.on('close',()=>req.signal.removeEventListener('abort',signalHandler));
      if (bytes.length) client.write(bytes);
      client.end();
    });
  };
}
