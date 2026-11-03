import {
  x402ResourceServer,
  x402HTTPResourceServer,
  HTTPFacilitatorClient
} from "@x402/core/server";
import { ExactXrplScheme } from "@x402/xrpl/exact/server";
import { isValidClassicAddress } from "xrpl";

const ASSETS = Object.freeze({
  XRP: {
    asset: "XRP"
  },
  RLUSD: {
    asset: "524C555344000000000000000000000000000000",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
  },
  USDC: {
    asset: "5553444300000000000000000000000000000000",
    issuer: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE"
  }
});

function requirePrice(asset, amount) {
  if (typeof amount !== "string") {
    throw new TypeError("CPX_SELLER_AMOUNT_MUST_BE_STRING");
  }

  if (asset === "XRP") {
    if (!/^[1-9][0-9]*$/.test(amount)) {
      throw new Error("CPX_SELLER_XRP_REQUIRES_POSITIVE_DROPS");
    }
    return;
  }

  if (
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount) ||
    !/[1-9]/.test(amount)
  ) {
    throw new Error("CPX_SELLER_INVALID_ISSUED_AMOUNT");
  }
}

export function createCpXSellerConfig({
  walletAddress,
  asset,
  amount,
  method = "GET",
  path = "/paid",
  description = "Paid XRPL agent service",
  invoiceId,
  destinationTag
}) {
  if (!isValidClassicAddress(walletAddress)) {
    throw new Error("CPX_SELLER_INVALID_WALLET_ADDRESS");
  }

  if (!Object.hasOwn(ASSETS, asset)) {
    throw new Error("CPX_SELLER_UNSUPPORTED_ASSET");
  }

  requirePrice(asset, amount);

  if (invoiceId !== undefined && (typeof invoiceId !== 'string' || invoiceId.length < 1 || invoiceId.length > 256)) {
    throw new Error("CPX_SELLER_INVOICE_REQUIRED");
  }

  if (destinationTag !== undefined && (!Number.isSafeInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff)) {
    throw new Error("CPX_SELLER_DESTINATION_TAG_REQUIRED");
  }

  if (!["GET", "POST"].includes(method)) {
    throw new Error("CPX_SELLER_UNSUPPORTED_METHOD");
  }

  if (
    typeof path !== "string" ||
    !new RegExp("^/[a-zA-Z0-9/_-]+$").test(path) ||
    path.includes("//") ||
    path.includes("..")
  ) {
    throw new Error("CPX_SELLER_INVALID_ROUTE");
  }

  const token = ASSETS[asset];

  const paymentOption = {
    scheme: "exact",
    network: "xrpl:0",
    maxTimeoutSeconds: 600,
    payTo: walletAddress,
    price: {
      asset: token.asset,
      amount,
      ...(token.issuer
        ? { extra: { issuer: token.issuer } }
        : {})
    },
    extra: {
      ...(token.issuer ? { issuer: token.issuer } : {}),
      ...(invoiceId === undefined ? {} : { invoiceId }),
      ...(destinationTag === undefined ? {} : { destinationTag }),
      areFeesSponsored: false,
      assetTransferMethod: 'sequence'
    }
  };

  return {
    [`${method} ${path}`]: {
      accepts: [paymentOption],
      description,
      mimeType: "application/json"
    }
  };
}

export function createCpXSellerServer({
  facilitatorUrl,
  routes
}) {
  if (
    typeof facilitatorUrl !== "string" ||
    !facilitatorUrl.startsWith("https://")
  ) {
    throw new Error("CPX_SELLER_HTTPS_FACILITATOR_REQUIRED");
  }

  if (
    !routes ||
    typeof routes !== "object" ||
    Array.isArray(routes)
  ) {
    throw new Error("CPX_SELLER_ROUTES_REQUIRED");
  }

  const facilitatorClient = new HTTPFacilitatorClient({
    url: facilitatorUrl
  });

  // Observe official verification results without changing them.
  const facilitator = new Proxy(facilitatorClient, {
    get(target, property) {
      if (property === "verify") {
        return async (...args) => {
          try {
            const result = await target.verify(...args);

            if (result?.isValid === false) {
              console.error("[CPX_T54_VERIFY]", {
                isValid: false,
                invalidReason: result.invalidReason ?? null,
                invalidMessage: result.invalidMessage ?? null
              });
            }

            return result;
          } catch (error) {
            console.error("[CPX_T54_VERIFY_EXCEPTION]", {
              name: error?.name ?? "Error"
            });
            throw error;
          }
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function"
        ? value.bind(target)
        : value;
    }
  });

  const resourceServer = new x402ResourceServer(facilitator)
    .register("xrpl:*", new ExactXrplScheme());

  return new x402HTTPResourceServer(resourceServer, routes);
}
