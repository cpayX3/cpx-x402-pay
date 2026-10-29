# cpX x402 Pay + Earn

**XRPL-native payment infrastructure for autonomous AI agents.**

**One SDK. Two capabilities. Three XRPL assets.**

`npm install @cloudpayx/x402-pay`

cpX x402 Pay enables autonomous AI agents to purchase x402-protected services using XRP, RLUSD, and Circle USDC on the XRP Ledger.

The SDK provides wallet-agnostic signing integration, explicit payment authorization, spending controls, guarded transactions, persistent payment tracking, and validated-ledger settlement reconciliation.

Self-funded agents can integrate without a cloudpayX account, dashboard, or mandatory wallet provider.

## Developer and agent integration guides

- [Quick Start](docs/QUICKSTART.md)
- [API Reference](docs/API.md)
- [Agent Instructions](AGENTS.md)
- [Machine-readable Manifest](docs/agent-manifest.json)
- [Earn HTTP Example](examples/earn-http-server.mjs)

## Installation

`npm install @cloudpayx/x402-pay`

**Network:** XRPL mainnet (`xrpl:0`)
**Protocol:** x402 V2, `exact`
**Assets:** XRP, RLUSD, Circle USDC

## Quick start: validate a payment configuration

Start with a no-wallet example before connecting a live XRPL signer.

From the SDK project:

    npm install
    node examples/quickstart-validation.mjs

The example imports the published SDK interface, configures an XRP purchase, and calls `validateSecureNodePurchase()`.

It uses placeholder addresses and a signer that refuses to sign. **No funds move.**

Validation confirms the guarded configuration structure. It does not authorize a payment, validate an address checksum, or verify settlement.

For live integration, replace the placeholders with a compatible XRPL signer, real payment details, and your own authorization policy. Use `executeSecureNodePurchase()` for execution and `reconcileSecureNodePurchase()` for settlement verification.

## cpX x402 Earn — Agent monetization

Turn agent capabilities into paid services with XRPL-native settlement.

cpX x402 Earn verifies payment requirements, enforces persistent replay protection, checks transaction identity, and independently confirms XRPL ledger settlement before delivering protected resources.

**Security by design:** Unsupported payment-processing sequences are rejected rather than permitted to bypass settlement verification.

The public SDK exposes `createCpXAgentEarn()` for configuring a protected XRPL payment endpoint.

## Capabilities

- **Autonomous agent payments:** Agents can purchase compatible x402 resources using their own XRPL signing infrastructure.
- **Wallet-agnostic integration:** No mandatory wallet brand or cloudpayX custody.
- **Three-asset support:** Native XRP, Ripple-issued RLUSD, and Circle-issued USDC with issuer validation.
- **Payment authorization:** Explicit autonomous opt-in or application-controlled approval.
- **Spending controls:** Per-asset limits, persistent aggregate budgets, recipient restrictions, and transaction fee ceilings.
- **Guarded signing:** Checks transaction destination, asset, amount, invoice binding, fees, and other transaction constraints.
- **Durable payment records:** Persistent journals and duplicate-payment protections.
- **Settlement verification:** Reconciliation against validated XRPL transaction evidence.
- **Protected resource access:** HTTPS validation, anti-SSRF protections, and redirect restrictions.

## Optional cloudpayX paid APIs

The cpX x402 Pay + Earn SDK is free. Developers and autonomous agents can optionally use cloudpayX-hosted services on a pay-per-call basis, without a monthly subscription.

These services are hosted APIs, not local SDK exports.

### Agent intelligence APIs

| Service | Endpoint | Price |
| --- | --- | ---: |
| Arbitrage Check | /agent/v3/arbitrage-check | $0.01 |
| Risk Check | /agent/risk-check | $0.02 |
| Ledger Status | /agent/ledger-status | $0.005 |
| Token Analysis | /agent/token-analysis | $0.005 |
| Asset Analysis | /agent/v3/asset-analysis | $0.005 |
| Stablecoin Route | /agent/v3/stablecoin-route | $0.01 |
| Wallet Vibe Check | /agent/v3/wallet-vibe-check | $0.01 |
| Transaction Repair | /agent/repair | $0.10 |

### Connector-backed business APIs

| Capability | Endpoint | Price |
| --- | --- | ---: |
| availability.check | /agent/v3/availability-check | $0.01 |
| price.quote | /agent/v3/price-quote | $0.01 |
| order.prepare | /agent/v3/order-prepare | $0.01 |

Business APIs use configured HTTP providers for authorized inventory, pricing, and order data. If no matching provider is available, the API returns an explicit unavailable-provider response. Order preparation does not commit a purchase or authorize payment.

API host: https://api.cloudpayxagent.xyz

Paid endpoints use x402 payment requirements. Inspect the payment challenge for current settlement options. The hosted API payment options are separate from the XRPL-only cpX x402 Pay SDK.

## Public SDK API

Import the guarded payment operations from `@cloudpayx/x402-pay`.

| Export | Purpose |
| --- | --- |
| `validateSecureNodePurchase` | Validate a proposed guarded payment configuration. |
| `executeSecureNodePurchase` | Execute a policy-controlled XRPL x402 purchase. |
| `reconcileSecureNodePurchase` | Reconcile an existing purchase against validated XRPL ledger evidence. |
| `createCpXAgentEarn` | Protect and monetize agent services with verified XRPL settlement. |

Payment execution requires compatible signing infrastructure and application-supplied authorization and policy configuration.

## Supported assets

| Asset | Network | Amount format |
| --- | --- | --- |
| XRP | XRPL mainnet | Integer drops |
| RLUSD | XRPL mainnet | Decimal token amounts, Ripple issuer-bound |
| Circle USDC | XRPL mainnet | Decimal token amounts, Circle issuer-bound |

**cpX x402 Pay is XRPL-only.** It does not execute Base/EVM payments, automatically swap tokens, or substitute unrelated assets with similar names.

## Payment lifecycle

1. An agent requests an x402-protected resource.
2. The resource returns payment requirements.
3. The SDK validates the payment requirements and configured spending authorization.
4. The guarded transaction is signed and submitted through the payment flow.
5. Purchase state and transaction evidence are preserved.
6. Ledger reconciliation verifies the settlement outcome.

Uncertain payment results require reconciliation rather than automatic duplicate payment attempts.

## Security architecture

The guarded SDK interface incorporates explicit authorization, spending budgets, transaction-signing restrictions, invoice binding, issuer validation, fee controls, duplicate-payment protection, safe resource-host validation, and ledger reconciliation.

Applications must secure their XRPL signing credentials independently. An agent with unrestricted access to wallet keys can bypass local SDK policies outside the guarded interface.

Issued-token payments require applicable trustlines, sufficient balances, and XRP for network fees and reserves. Third-party resource delivery depends on the seller and network conditions.

## Resources

- Website: https://cloudpayx.com
- Agent infrastructure: https://api.cloudpayxagent.xyz
- npm: https://www.npmjs.com/package/@cloudpayx/x402-pay
- XRPL x402 specification: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md

**cloudpayX | Infrastructure for the autonomous economy**

Agent discovery: https://cloudpayx.com/agents
