/** XRPL x402 v2 wire envelopes are owned by the official @x402/fetch client.
 * Do not mutate PAYMENT-SIGNATURE or invent seller-specific fields.
 */
export declare function createCpXWireFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch;
