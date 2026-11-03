# cpX x402 Pay | Autonomous Agent Onboarding

Network: XRPL mainnet (xrpl:0)
Protocol: x402 V2, exact
SDK: @cloudpayx/x402-pay
Status: Integration guidance
Custody: None

## Purpose

This guide helps autonomous agents prepare their own XRPL wallets
to purchase x402-protected resources through cpX x402 Pay.

cloudpayX does not create wallets, hold private keys, fund accounts,
or independently authorize an agent's spending.

An agent may use its own wallet infrastructure or an existing
compatible XRPL wallet signer.

## 1. Prepare an XRPL wallet

If you already control an XRPL wallet, continue to Step 2.

Otherwise:

1. Choose an existing XRPL-compatible wallet or wallet library.
2. Generate credentials using that wallet's own secure process.
3. Keep private keys and recovery credentials under your control.
4. Obtain the wallet's XRPL classic address.
5. Ensure your signing infrastructure can sign XRPL transactions.

Never send wallet seeds or private keys to cloudpayX.

XRPL account documentation:
https://xrpl.org/docs/concepts/accounts

## 2. Activate and fund the account

An XRPL wallet address must be funded before its account exists
on the ledger.

Obtain sufficient XRP for:

- Account activation and current reserve requirements
- Additional ledger objects, where applicable
- XRPL transaction fees
- XRP payments, if purchasing with XRP

Check current reserve requirements before funding.

Reserve documentation:
https://xrpl.org/docs/concepts/accounts/reserves

cpX x402 Pay does not supply XRP automatically.

## 3. Supported payment assets

cpX x402 Pay supports only these mainnet assets:

XRP:
  Network: xrpl:0
  Currency: XRP
  Issuer: none
  Payment amount: integer drops

RLUSD:
  Network: xrpl:0
  Currency: 524C555344000000000000000000000000000000
  Issuer: rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De
  Payment amount: decimal token units

Circle USDC:
  Network: xrpl:0
  Currency: 5553444300000000000000000000000000000000
  Issuer: rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE
  Payment amount: decimal token units

These identifiers reflect the existing cpX payment implementation.

Do not substitute another issuer merely because a token uses
the same symbol.

For XRP, 1000000 drops equals 1 XRP.

The SDK's payment intent, signing guard, and budget policies
must use their documented amount formats consistently.

## 4. Prepare RLUSD or USDC

If paying with XRP, no token trust line is required.

If paying with RLUSD or USDC:

1. Verify the selected issuer and currency identity.
2. Use your existing wallet's TrustSet capability to establish
   any required trust line.
3. Ensure the account has enough XRP for applicable reserves
   and transaction fees.
4. Acquire the intended token through a suitable provider.
5. Check the token balance and any applicable restrictions.

A trust line alone does not guarantee the ability to spend a token.

Issuer authorization, freezes, and other ledger restrictions
may prevent a transaction.

Trust line documentation:
https://xrpl.org/docs/concepts/tokens/fungible-tokens/trust-line-tokens

## 5. Install cpX x402 Pay

npm install @cloudpayx/x402-pay

The SDK is wallet-agnostic.

It does not require:
- A cloudpayX account
- A cloudpayX dashboard
- A particular wallet brand
- Hosted signing or custody

## 6. Configure an existing signer

The public secure purchase function accepts a compatible
XRPL signer through its signer option.

That signer must correspond to the payment intent's payer
account and support the signing interface required by the SDK.

For example, the SDK's validation example represents a signer
using classicAddress and sign.

This guide does not generate a signer or store its credentials.

An autonomous agent must establish its own spending authority,
permitted recipients, per-asset limits, and transaction fee caps.

## 7. Validate before paying

The working public SDK exposes:

- validateSecureNodePurchase(options)
- executeSecureNodePurchase(options)
- reconcileSecureNodePurchase(options)

Start with:

node examples/quickstart-validation.mjs

Run that command from the SDK source repository.

This example checks payment configuration structure using
placeholder addresses and a signer that refuses to sign.

It does NOT perform a payment.

It does NOT confirm that a wallet is funded or payment-ready.

For a real purchase, use valid account and seller details,
a compatible agent-controlled signer, configured policies,
a durable journal location, and the original resource request.

## 8. Execute a supported x402 purchase

Follow the existing SDK's guarded payment workflow.

The agent requests an x402-protected resource and receives
the seller's payment requirements.

The SDK validates the transaction requirements, economic
intent, signer, spending authorization, and configured limits.

The payment flow must preserve its original transaction
details and enforce the signing restrictions.

Call executeSecureNodePurchase() only with a valid,
independently authorized secure purchase configuration.

Do not manually manufacture payment-signature headers.

The existing x402 client handles the signed payment proof
inside the guarded payment flow.

## 9. Verify settlement

An HTTP success response is not proof of XRPL settlement.

Use reconcileSecureNodePurchase() with the original
journalDir and intentId to verify existing transaction
evidence against the validated XRP Ledger.

For an uncertain or interrupted payment result:

- Preserve the original intent and durable journal.
- Reconcile the previous transaction.
- Do not blindly submit a replacement payment.

A new payment attempt is not automatically authorized by
a timeout or an unavailable ledger response.

## 10. Technical references

SDK package:
https://www.npmjs.com/package/@cloudpayx/x402-pay

Source:
https://github.com/cpayX3/cpx-x402-pay

XRPL x402 specification:
https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md

XRPL account setup:
https://xrpl.org/docs/concepts/accounts

XRPL reserves:
https://xrpl.org/docs/concepts/accounts/reserves

XRPL trust lines:
https://xrpl.org/docs/concepts/tokens/fungible-tokens/trust-line-tokens

cloudpayX agent infrastructure:
https://api.cloudpayxagent.xyz

## Important limitations

This document is guidance, not a wallet-generation service.

It does not create accounts, distribute funding, sign
transactions, approve payments, or guarantee resource delivery.

The existing cpX x402 Pay SDK remains the authority for
supported payment behavior.

Before a real payment, verify the installed SDK version,
the seller's payment requirements, and all signing and
authorization policies.
