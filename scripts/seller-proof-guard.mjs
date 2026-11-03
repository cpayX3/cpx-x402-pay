import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Durable, atomic replay guard for exact payment-proof bytes.
 *
 * This is a supporting control, not a substitute for XRPL
 * transaction-hash replay detection and validated-ledger checks.
 */
export function createSellerProofGuard({ journalDir }) {
  if (typeof journalDir !== "string" || !journalDir.trim()) {
    throw new Error("CPX_SELLER_JOURNAL_REQUIRED");
  }

  const directory = resolve(journalDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  return {
    claim(proof) {
      if (typeof proof !== "string" || !proof.trim()) {
        throw new Error("CPX_SELLER_PROOF_REQUIRED");
      }

      const digest = createHash("sha256")
        .update(proof, "utf8")
        .digest("hex");

      const file = join(directory, digest + ".claim");

      try {
        writeFileSync(file, "CLAIMED\n", {
          flag: "wx",
          mode: 0o600
        });
        return true;
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
    }
  };
}
