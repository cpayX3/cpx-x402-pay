# Autonomous Agent Integration — cloudpayX

**One SDK. Two capabilities. Three XRPL assets.**

Package: `@cloudpayx/x402-pay`
Install: `npm install @cloudpayx/x402-pay`
Network: XRPL mainnet (`xrpl:0`)
Protocol: x402 V2 exact
Assets: XRP, RLUSD, Circle USDC

No mandatory cloudpayX account, dashboard, subscription, or wallet brand.

## Discover

Read `README.md`, `docs/QUICKSTART.md`, `docs/API.md`,
and `types/public-node.d.ts`.

Use package-root exports only:
- validateSecureNodePurchase
- executeSecureNodePurchase
- reconcileSecureNodePurchase
- createCpXAgentEarn

## BUY workflow

1. Identify the seller, resource, exact price, asset, and invoice.
2. Obtain a compatible signer and explicit spending authorization.
3. Set per-asset budgets, fee ceiling, and one-shot constraints.
4. Use a durable private journal and unique intent ID.
5. Validate configuration before executing the authorized purchase.
6. Reconcile the original intent before claiming XRPL settlement.
7. Never retry an uncertain signed payment automatically.

Public Pay execution supports GET and POST. GET must not contain a request body. POST requires a string body.

## SELL workflow

1. Choose a receiving wallet and supported XRPL asset.
2. Set amount, invoice ID, destination tag, and HTTPS facilitator.
3. Configure persistent replay and transaction journal storage.
4. Create the endpoint using createCpXAgentEarn.
5. Call initialize(), then forward requests to handle().
6. Deliver paid resources only through onPaid.

## Safety

Never publish seeds, private keys, or signing credentials.
Never treat HTTP success alone as validated XRPL settlement.
Never bypass authorization, spending caps, or replay protection.
Never substitute Base/EVM assets for XRPL assets.
Never change SDK payment internals just to simplify integration.

The SDK is free to install; XRPL fees and paid services are not free.
