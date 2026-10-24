export type ExpectedXrplSettlement = {
    /** SHA-512Half transaction hash as returned by the original signer, 64 hex chars. */
    transactionHash: string;
    payer: string;
    recipient: string;
    destinationTag?: number;
    sourceTag?: number;
    /** SHA-256(invoiceId string), upper-case 64 hex, bound by the signing guard. */
    invoiceID: string;
    asset: string;
    issuer?: string;
    amount: string;
    maxFeeDrops: string;
};
/** Throws on any uncertain or unexpected result. Never authorizes retry. */
export declare function verifyValidatedXrplSettlement(payload: unknown, expected: ExpectedXrplSettlement): Readonly<{
    status: "VALIDATED_SUCCESS";
    transactionHash: string;
    ledgerIndex: number;
    deliveredAmount: string;
    asset: string;
    feeDrops: string;
    invoiceID: string;
}>;
