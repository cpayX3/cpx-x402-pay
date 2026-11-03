# cpX x402 Pay + Earn — Quick Start

**One SDK. Two capabilities. Three XRPL assets.**

Install: `npm install @cloudpayx/x402-pay`

Network: XRPL mainnet (`xrpl:0`).
Protocol: x402 V2, exact.
Assets: XRP, Ripple RLUSD, Circle USDC.

No mandatory cloudpayX account, subscription, dashboard, or wallet provider.
XRPL fees, purchased services, and third-party facilitator charges may apply.

## Pay — Buy agent services

Import `validateSecureNodePurchase`, `executeSecureNodePurchase`, and
`reconcileSecureNodePurchase` from `@cloudpayx/x402-pay`.

Start with `node examples/quickstart-validation.mjs` in the source repository.
This validates configuration without moving funds.

For an authorized live purchase, provide:
- Stable unique intent ID (at least 12 characters)
- Payer, seller, public HTTPS resource, asset, and exact amount
- Compatible XRPL signer with matching classicAddress
- Explicit authorization policy and recipient restrictions
- Positive persistent budgets for XRP drops, RLUSD, and USDC
- One-shot guard matching recipient, asset, amount, and fee ceiling
- Issuer and maxSendMax for RLUSD or USDC
- Private durable journal directory
- GET request without a body, or POST request with a string body

Call `validateSecureNodePurchase(options)` to check configuration.
Call `executeSecureNodePurchase(options)` only after authorization.

An HTTP response is NOT verified XRPL settlement.

For an existing journaled purchase:

    import { reconcileSecureNodePurchase } from "@cloudpayx/x402-pay";

    const receipt = await reconcileSecureNodePurchase({
      journalDir: "./private-payment-journal",
      intentId: "original-unique-intent-id"
    });

Only a `VALIDATED_SUCCESS` receipt establishes settlement through this API.
Never automatically repeat a payment after a timeout or uncertain outcome.

## Earn — Sell agent services

Import `createCpXAgentEarn` from `@cloudpayx/x402-pay`.

Configure a receiving wallet, asset, positive amount, invoice ID,
destination tag, HTTPS facilitator, durable journal, and `onPaid` callback.

Call `initialize()` before routing incoming Fetch API Request objects
through `handle(request)`. Return the resulting Response to the caller.

See `examples/earn-http-server.mjs` for a Node HTTP adapter.
The paid service must only be delivered from `onPaid`.

## Amounts

- XRP: positive integer drops (1 XRP = 1,000,000 drops).
- RLUSD: positive decimal units, Ripple issuer.
- USDC: positive decimal units, Circle issuer.

Issued-token wallets need the applicable trustlines, balances, and XRP
for fees and reserves.

See `docs/API.md` and `AGENTS.md`.
