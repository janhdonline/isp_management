/**
 * A stand-in for SSLCommerz, so the webhook can be tested without a merchant
 * account or an internet connection.
 *
 * It is a *separate* mock from the RouterOS one on purpose: that speaks HTTP
 * REST, this speaks form-encoded POST plus a validation API, and forcing them
 * into one file would make both harder to read.
 *
 * What it reproduces faithfully, because these are exactly the cases the webhook
 * exists to handle:
 *
 *  - a session that starts successfully and returns a checkout URL;
 *  - a session that is refused, so a "Pay Online" button cannot hand a customer
 *    a dead page;
 *  - a validation endpoint that confirms a transaction *and its amount*;
 *  - a validation endpoint that rejects an unknown transaction, which is what
 *    stops a forged callback.
 */
import { createServer } from "node:http";

/** Every transaction the fake knows about, keyed by val_id. */
const known = new Map();

export const gatewayCalls = [];

export function startMockGateway({ port = 0, refuseSession = false } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    gatewayCalls.push({ method: req.method, path: url.pathname });

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(text),
        });
        res.end(text);
      };

      if (url.pathname === "/gwprocess/v4/api.php" && req.method === "POST") {
        if (refuseSession) {
          return json(200, { status: "FAILED", message: "Session refused by the gateway" });
        }
        const form = new URLSearchParams(body);
        const tranId = form.get("tran_id") ?? "";
        const amount = Number(form.get("total_amount") ?? 0);

        const valId = `VAL-${tranId}`;
        known.set(valId, { tranId, amount, status: "VALID" });

        return json(200, {
          status: "SUCCESS",
          sessionkey: tranId,
          GatewayPageURL: `http://127.0.0.1:${server.address().port}/checkout/${tranId}`,
        });
      }

      if (url.pathname === "/validator/api/validationserverAPI.php") {
        const valId = url.searchParams.get("val_id") ?? "";
        const tranId = url.searchParams.get("tran_id") ?? "";
        const claimed = Number(url.searchParams.get("amount") ?? "0");
        const record = known.get(valId);

        // Unknown, or the reference does not match: the shape SSLCommerz uses to
        // report a transaction it does not recognise.
        if (!record || record.tranId !== tranId) {
          return json(200, [
            { errorCode: "BD-P1", errorMessage: "No transaction found" },
          ]);
        }

        // The amount is part of the answer. A callback claiming a different
        // figure gets the real one back, so the caller can compare.
        return json(200, {
          status: record.status,
          val_id: valId,
          tran_id: record.tranId,
          amount: String(record.amount),
          currency: "BDT",
          bank_tran_id: `BANK-${tranId}`,
        });
        void claimed;
      }

      if (url.pathname.startsWith("/checkout/")) {
        return json(200, { ok: true });
      }

      return json(404, { error: 404 });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        baseUrl: `http://127.0.0.1:${actual}`,
        /** Registers a transaction the gateway will vouch for. */
        seed(valId, { tranId, amount, status = "VALID" }) {
          known.set(valId, { tranId, amount, status });
        },
        /** Forgets a transaction, so a validation now fails. */
        forget(valId) {
          known.delete(valId);
        },
        setStatus(valId, status) {
          const r = known.get(valId);
          if (r) r.status = status;
        },
        calls: () => gatewayCalls.slice(),
        reset() {
          gatewayCalls.length = 0;
          known.clear();
        },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
