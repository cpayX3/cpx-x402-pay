import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createCpXAgentEarn } from "@cloudpayx/x402-pay";

const address = process.env.XRPL_RECEIVING_ADDRESS;
const facilitator = process.env.X402_FACILITATOR_URL;

if (!address || !facilitator) {
  console.error("Set XRPL_RECEIVING_ADDRESS and X402_FACILITATOR_URL.");
  process.exitCode = 1;
} else {
  const earn = createCpXAgentEarn({
    walletAddress: address,
    asset: process.env.CPX_ASSET ?? "XRP",
    amount: process.env.CPX_AMOUNT ?? "1000",
    invoiceId: process.env.CPX_INVOICE_ID ?? "agent-service-001",
    destinationTag: Number(process.env.CPX_DESTINATION_TAG ?? "12345"),
    facilitatorUrl: facilitator,
    journalDir: process.env.CPX_EARN_JOURNAL ?? "./private-earn-journal",
    method: "POST",
    path: "/paid",
    onPaid: async (_request, _settlement) =>
      Response.json({ delivered: true, result: "Replace with your service" })
  });

  await earn.initialize();

  createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const request = new Request(
        new URL(req.url, "http://localhost"),
        {
          method: req.method,
          headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : {
            body: Readable.toWeb(req),
            duplex: "half"
          })
        }
      );

      const response = await earn.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("Earn request error:", error?.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Service unavailable" }));
    }
  }).listen(8788, "127.0.0.1", () => {
    console.log("Earn example: http://127.0.0.1:8788/paid");
    console.log("Deploy behind appropriately secured HTTPS for public access.");
  });
}
