# cpX x402 Pay + Earn — Public API

Package: `@cloudpayx/x402-pay`
Network: XRPL mainnet only (`xrpl:0`).

## Pay

`validateSecureNodePurchase(options)` returns true or throws.
It validates configuration shape, not settlement or authorization.

`executeSecureNodePurchase(options)` starts at most one guarded purchase.
Its response includes:
- status: `HTTP_RESPONSE_LEDGER_UNVERIFIED`
- httpStatus
- paymentResponseHeaderPresent
- journalStatus

Required options:
- intent: intentId, payer, seller, resource, asset, amount
- journalDir: private durable directory
- budgetCaps: xrpDrops, rlusd, usdc (positive strings)
- signer: matching classicAddress and sign function
- policy: explicit payment authorization configuration
- oneShot: recipient, asset, exactAmount, maxFeeDrops
- maxFeeDrops: positive string matching oneShot
- request: matching URL with GET (no body) or POST (required string body, maximum 262144 characters)

For issued tokens, oneShot additionally requires issuer and maxSendMax.
Optional timeoutMs: 1–60000, default 20000.

Initial requests cannot contain payment-signature, x-payment,
authorization, or cookie headers.

`reconcileSecureNodePurchase({ journalDir, intentId })` performs read-only
ledger recovery. Successful results contain:
- status: VALIDATED_SUCCESS
- transactionHash
- ledgerIndex
- deliveredAmount
- asset
- feeDrops
- invoiceID

Reconciliation never resubmits a transaction.

## Earn

`createCpXAgentEarn(options)` accepts:
- walletAddress: valid XRPL classic receiving address
- asset: XRP, RLUSD, or USDC
- amount: positive string (XRP in drops)
- invoiceId: 1–256 characters
- destinationTag: integer 0–4294967295
- facilitatorUrl: HTTPS URL
- journalDir: persistent private directory
- onPaid: (request, settlement) => Response or Promise<Response>
- method: GET or POST, optional; default POST
- path: valid route, optional; default /paid

Returns:
- initialize(): initialize x402 resource server
- handle(request): process Fetch API Request and return Response

Earn uses proof replay protection, transaction identity checks, and
validated-ledger verification before paid resource delivery.
Unsupported processing sequences fail closed.

## Asset identifiers

RLUSD issuer: rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De
USDC issuer: rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE

This SDK does not support Base/EVM settlement.
Do not expose wallet secrets or bypass public guarded APIs.

Canonical TypeScript signatures: `types/public-node.d.ts`.
