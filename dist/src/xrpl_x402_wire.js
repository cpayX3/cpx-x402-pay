function decode(header) {
    if (header.length > 131072)
        throw Error("CPX_PAYMENT_HEADER_TOO_LARGE");
    try {
        const binary = atob(header);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw Error("CPX_INVALID_PAYMENT_ENVELOPE");
    }
}
function encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 8192)));
    }
    return btoa(binary);
}
export function createCpXWireFetch(baseFetch) {
    return async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.protocol !== "https:" || url.username || url.password)
            throw Error("CPX_UNSAFE_PAYMENT_URL");
        const safe = new Request(request, { redirect: "error" });
        const signature = safe.headers.get("PAYMENT-SIGNATURE");
        if (!signature)
            return baseFetch(safe);
        const payment = decode(signature);
        const accepted = payment?.accepted;
        const extra = accepted?.extra;
        const isT54Xrp = payment?.x402Version === 2 &&
            accepted?.scheme === "exact" &&
            accepted?.network === "xrpl:0" &&
            accepted?.asset === "XRP" &&
            extra?.sourceTag === 804681468;
        // Existing RLUSD and USDC envelopes remain unchanged.
        if (!isT54Xrp)
            return baseFetch(safe);
        const invoice = extra?.invoiceId;
        const payload = payment.payload;
        if (extra?.areFeesSponsored !== false ||
            typeof invoice !== "string" ||
            invoice.length < 1 ||
            invoice.length > 128 ||
            typeof accepted?.payTo !== "string" ||
            !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(accepted.payTo) ||
            typeof accepted?.amount !== "string" ||
            !/^[1-9][0-9]*$/.test(accepted.amount) ||
            !payload ||
            typeof payload.signedTxBlob !== "string" ||
            !/^(?:[0-9a-fA-F]{2})+$/.test(payload.signedTxBlob) ||
            (payload.invoiceId !== undefined &&
                payload.invoiceId !== invoice)) {
            throw Error("CPX_T54_WIRE_VALIDATION_FAILED");
        }
        const headers = new Headers(safe.headers);
        headers.set("PAYMENT-SIGNATURE", encode({
            ...payment,
            payload: { ...payload, invoiceId: invoice }
        }));
        return baseFetch(new Request(safe, {
            headers,
            redirect: "error"
        }));
    };
}
