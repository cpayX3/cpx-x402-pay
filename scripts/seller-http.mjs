/**
 * cpX Agent Earn: settlement-gated Fetch API adapter.
 *
 * XRPL seller HTTP adapter with guarded payment verification, replay protection, and settlement-gated delivery.
 * Never calls the protected service before settlement succeeds.
 */

function reject(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export function createCpXSellerHandler({
  httpServer,
  proofGuard,
  transactionGuard,
  confirmLedger,
  method = "POST",
  path = "/paid",
  onPaid
}) {
  if (
    !httpServer ||
    typeof httpServer.processHTTPRequest !== "function" ||
    typeof httpServer.processSettlement !== "function"
  ) {
    throw new Error("CPX_SELLER_HTTP_SERVER_REQUIRED");
  }

  if (!proofGuard || typeof proofGuard.claim !== "function") {
    throw new Error("CPX_SELLER_PROOF_GUARD_REQUIRED");
  }

  if (
    !transactionGuard ||
    typeof transactionGuard.claimSignedTransaction !== "function"
  ) {
    throw new Error("CPX_SELLER_TRANSACTION_GUARD_REQUIRED");
  }

  if (typeof confirmLedger !== "function") {
    throw new Error("CPX_SELLER_LEDGER_VERIFIER_REQUIRED");
  }

  if (typeof onPaid !== "function") {
    throw new Error("CPX_SELLER_PAID_HANDLER_REQUIRED");
  }

  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    !["GET", "POST"].includes(method)
  ) {
    throw new Error("CPX_SELLER_INVALID_PROTECTED_ROUTE");
  }

  return async function handle(request) {
    if (!(request instanceof Request)) {
      return reject(400, "INVALID_REQUEST");
    }

    const requestUrl = new URL(request.url);

    if (
      request.method !== method ||
      requestUrl.pathname !== path
    ) {
      return reject(404, "ROUTE_NOT_FOUND");
    }

    const headers = request.headers;

    const adapter = {
      getHeader: name => headers.get(name) ?? undefined,
      getMethod: () => request.method,
      getPath: () => requestUrl.pathname,
      getUrl: () => request.url,
      getAcceptHeader: () => headers.get("accept") ?? "",
      getUserAgent: () => headers.get("user-agent") ?? "",
      getQueryParams: () =>
        Object.fromEntries(requestUrl.searchParams),
      getQueryParam: name =>
        requestUrl.searchParams.get(name) ?? undefined
    };

    const context = {
      adapter,
      path: requestUrl.pathname,
      method: request.method,
      paymentHeader:
        headers.get("payment-signature") ??
        headers.get("x-payment") ??
        undefined
    };

    let result;

    try {
      result = await httpServer.processHTTPRequest(context);
    } catch {
      return reject(503, "PAYMENT_VERIFICATION_UNAVAILABLE");
    }

    if (result?.type === "payment-error") {
      const response = result.response;
      const body = response?.body;
      let parsed = body;
      if (typeof body === "string") {
        try { parsed = JSON.parse(body); } catch { parsed = {}; }
      }
      const reason = parsed?.invalidReason ??
        parsed?.invalidMessage ??
        parsed?.errorMessage ??
        parsed?.errorReason ??
        parsed?.error ??
        parsed?.reason ??
        parsed?.verification?.invalidReason ??
        "UNSPECIFIED";

      if (context.paymentHeader) {
        console.error("[CPX_EARN_VERIFY_REJECTED]", {
          status: response?.status,
          reason: typeof reason === "string"
            ? reason.slice(0, 160) : "UNSPECIFIED",
          responseFields: parsed && typeof parsed === "object"
            ? Object.keys(parsed).slice(0, 20)
            : []
        });
      }

      if (!response || !Number.isInteger(response.status)) {
        return reject(503, "PAYMENT_RESPONSE_INVALID");
      }

      return new Response(
        response.body == null
          ? null
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body),
        {
          status: response.status,
          headers: {
            ...response.headers,
            "Cache-Control": "no-store"
          }
        }
      );
    }

    // This adapter protects ONLY paid endpoints.
    // An unexpected free-access result must not unlock content.
    if (result?.type !== "payment-verified") {
      return reject(403, "PAYMENT_REQUIRED");
    }

    // Enforce unsponsored XRPL payments before settlement.
    // Never settle a payment whose verified requirements
    // do not explicitly disable facilitator fee sponsorship.
    if (result.paymentRequirements?.extra?.areFeesSponsored !== false) {
      return reject(403, "CPX_FEE_SPONSORSHIP_NOT_ALLOWED");
    }

    // The installed XRPL server supports multiple payment flows.
    // Until each flow has been tested, refuse requests that report
    // a pre-handler settlement rather than assuming its outcome.
    if (result.beforeHandlerSettlement !== undefined) {
      return reject(503, "PRESETTLED_FLOW_NOT_YET_SUPPORTED");
    }

    // A verified proof must be claimed before settlement.
    // Atomic persistent claims block concurrent and repeated requests.
    const proof = context.paymentHeader;

    if (typeof proof !== "string" || !proof.trim()) {
      return reject(403, "PAYMENT_PROOF_MISSING");
    }

    try {
      if (!proofGuard.claim(proof)) {
        return reject(409, "PAYMENT_PROOF_ALREADY_CLAIMED");
      }
    } catch {
      return reject(503, "PAYMENT_PROOF_GUARD_UNAVAILABLE");
    }

    // Identify the signed XRPL transaction, not just its HTTP encoding.
    const signedTxBlob = result.paymentPayload?.payload?.signedTxBlob;

    if (typeof signedTxBlob !== "string" || !signedTxBlob) {
      return reject(403, "SIGNED_XRPL_TRANSACTION_MISSING");
    }

    let transactionClaim;
    try {
      transactionClaim =
        transactionGuard.claimSignedTransaction(signedTxBlob);
    } catch {
      return reject(503, "TRANSACTION_GUARD_UNAVAILABLE");
    }

    if (!transactionClaim?.claimed) {
      return reject(409, "XRPL_TRANSACTION_ALREADY_CLAIMED");
    }

    let settlement;

    try {
      settlement = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
        { request: context }
      );
    } catch {
      // A settlement timeout may be indeterminate.
      // Never retry settlement automatically here.
      return reject(503, "SETTLEMENT_OUTCOME_UNCERTAIN");
    }

    if (settlement?.success !== true) {
      const reason = settlement?.errorReason ??
        settlement?.error ?? settlement?.reason ?? "UNSPECIFIED";
      console.error("[CPX_EARN_SETTLEMENT_REJECTED]", {
        reason: typeof reason === "string"
          ? reason.slice(0, 160) : "UNSPECIFIED"
      });
      return reject(402, "PAYMENT_NOT_SETTLED");
    }

    // A successful facilitator response must identify the exact
    // signed XRPL transaction claimed before settlement.
    if (
      typeof transactionClaim?.hash !== "string" ||
      !/^[0-9A-Fa-f]{64}$/.test(transactionClaim.hash) ||
      typeof settlement.transaction !== "string" ||
      settlement.transaction.toUpperCase() !==
        transactionClaim.hash.toUpperCase() ||
      settlement.network !== "xrpl:0"
    ) {
      return reject(503, "SETTLEMENT_IDENTITY_MISMATCH");
    }

    // Independently confirm validated XRPL settlement.
    // A facilitator's success response alone cannot unlock content.
    let ledgerReceipt;
    try {
      ledgerReceipt = await confirmLedger({
        signedTxBlob,
        requirements: result.paymentRequirements
      });
    } catch {
      return reject(503, "LEDGER_CONFIRMATION_UNAVAILABLE");
    }

    if (
      ledgerReceipt?.validated !== true ||
      ledgerReceipt?.network !== "xrpl:0" ||
      typeof ledgerReceipt.transaction !== "string" ||
      ledgerReceipt.transaction.toUpperCase() !==
        transactionClaim.hash.toUpperCase()
    ) {
      return reject(503, "LEDGER_CONFIRMATION_MISMATCH");
    }

    // Only successful, independently confirmed settlement
    // reaches the protected service.
    try {
      const paidResponse = await onPaid(request, settlement);

      if (!(paidResponse instanceof Response)) {
        return reject(500, "PAID_HANDLER_INVALID_RESPONSE");
      }

      paidResponse.headers.set("Cache-Control", "no-store");

      return paidResponse;
    } catch {
      return reject(500, "PAID_SERVICE_FAILED");
    }
  };
}
