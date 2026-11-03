/** XRPL x402 v2 wire envelopes are owned by the official @x402/fetch client.
 * Do not mutate PAYMENT-SIGNATURE or invent seller-specific fields.
 */
export function createCpXWireFetch(baseFetch) {
    return (input, init) => baseFetch(input, init);
}
