import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const name = '@cloudpayx/x402-pay';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));

test('published SDK exposes the intended package identity and entry point', () => {
  assert.equal(pkg.name, '@cloudpayx/x402-pay');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.exports['.'].node, './scripts/public-node.mjs');
  assert.equal(pkg.exports['.'].types, './types/public-node.d.ts');
});

test('package root exposes ONLY secure purchase, validation, and read-only ledger reconciliation', async () => {
  const api = await import(name);
  assert.deepEqual(Object.keys(api).sort(), ['executeSecureNodePurchase', 'reconcileSecureNodePurchase', 'validateSecureNodePurchase']);
  assert.equal(typeof api.executeSecureNodePurchase, 'function');
  assert.equal(typeof api.validateSecureNodePurchase, 'function');
  assert.equal(typeof api.reconcileSecureNodePurchase, 'function');
});

for (const subpath of [
  '/src/index.js', '/src/policy.js', '/dist/src/index.js',
  '/dist/src/one_shot_guard.js', '/scripts/local-attempt-journal.mjs',
  '/scripts/durable-purchase-lifecycle.mjs', '/scripts/safe-agent-fetch.mjs',
  '/scripts/secure-node-purchase.mjs', '/scripts/trusted-xrpl-recovery.mjs', '/package.json'
]) {
  test('blocks accidental package subpath import ' + subpath, async () => {
    await assert.rejects(import(name + subpath), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
}
