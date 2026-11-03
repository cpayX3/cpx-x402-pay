import { hashes } from "xrpl";
import { createSellerProofGuard } from "./seller-proof-guard.mjs";

const HEX = /^(?:[0-9a-fA-F]{2})+$/;

export function getSellerTransactionHash(signedTxBlob) {
  if (
    typeof signedTxBlob !== "string" ||
    !HEX.test(signedTxBlob)
  ) {
    throw new Error("CPX_SELLER_SIGNED_TRANSACTION_REQUIRED");
  }

  const hash = hashes.hashSignedTx(signedTxBlob);

  if (
    typeof hash !== "string" ||
    !/^[0-9A-Fa-f]{64}$/.test(hash)
  ) {
    throw new Error("CPX_SELLER_INVALID_TRANSACTION_HASH");
  }

  return hash.toUpperCase();
}

export function createSellerTransactionGuard({ journalDir }) {
  const storage = createSellerProofGuard({ journalDir });

  return {
    claimSignedTransaction(signedTxBlob) {
      const hash = getSellerTransactionHash(signedTxBlob);

      return {
        hash,
        claimed: storage.claim("xrpl:0:transaction:" + hash)
      };
    }
  };
}
