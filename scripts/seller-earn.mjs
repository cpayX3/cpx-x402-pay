import { join, resolve } from "node:path";
import { createCpXSellerConfig, createCpXSellerServer } from "./seller-node.mjs";
import { createCpXSellerHandler } from "./seller-http.mjs";
import { createSellerProofGuard } from "./seller-proof-guard.mjs";
import { createSellerTransactionGuard } from "./seller-transaction-guard.mjs";
import { confirmSellerLedgerPayment } from "./seller-ledger-verifier.mjs";

/**
 * cpX Agent Earn: XRPL-mainnet seller.
 * No wallet secret or signing key required.
 */
export function createCpXAgentEarn({
  walletAddress,
  asset,
  amount,
  invoiceId,
  destinationTag,
  facilitatorUrl,
  journalDir,
  onPaid,
  method = "POST",
  path = "/paid"
}) {
  if (typeof journalDir !== "string" || !journalDir.trim()) {
    throw Error("CPX_SELLER_JOURNAL_REQUIRED");
  }

  if (typeof onPaid !== "function") {
    throw Error("CPX_SELLER_PAID_HANDLER_REQUIRED");
  }

  const routes = createCpXSellerConfig({
    walletAddress,
    asset,
    amount,
    invoiceId,
    destinationTag,
    method,
    path
  });

  const server = createCpXSellerServer({
    facilitatorUrl,
    routes
  });

  const directory = resolve(journalDir);

  const handle = createCpXSellerHandler({
    httpServer: server,
    proofGuard: createSellerProofGuard({
      journalDir: join(directory, "proofs")
    }),
    transactionGuard: createSellerTransactionGuard({
      journalDir: join(directory, "transactions")
    }),
    confirmLedger: confirmSellerLedgerPayment,
    method,
    path,
    onPaid
  });

  return Object.freeze({
    initialize: () => server.initialize(),
    handle
  });
}
