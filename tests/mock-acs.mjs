/**
 * A fake CPE — the customer's ONT — for testing zero-touch provisioning.
 *
 * It plays both halves of the conversation, because a zero-touch flow needs both:
 *
 *  - **It speaks Inform to us.** An unconfigured ONU boots, finds an ACS, and
 *    announces itself. `inform()` posts that to the real route handler.
 *  - **It stands in for the device management API we push config to.** Real ONUs
 *    are behind vendor ACS bridges, so what the `HttpTr069Adapter` talks to is a
 *    separate base URL; this server is it.
 *
 * The assertions live here rather than in the tests: a fake device that quietly
 * accepts a malformed payload is worse than no fake at all, because the test goes
 * green on a config that would never work on real hardware.
 *
 * ## Using it from the command line
 *
 *   node tests/mock-acs.mjs --inform HWTC1234567890
 *   node tests/mock-acs.mjs --inform HWTC1234567890 --acs http://127.0.0.1:3000 --secret s3cret
 *
 * That posts a real Inform to a running server and prints the reply, which is the
 * quickest way to see whether a device would be accepted. Against a server with
 * TR-069 switched off it answers 503, which is the correct answer.
 *
 * ## Using it from a test
 *
 *   const cpe = await startMockCpe({ secret });
 *   process.env.TR069_DEVICE_API_URL = cpe.url;
 *   await cpe.inform({ serialNo: "HWTC1", vendor: "Huawei", model: "MA5800" });
 *   cpe.lastConfig();   // what the device was told
 *   cpe.rejectNext(true);
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** Everything a device has been told, newest last. */
const received = [];

/**
 * What a real Inform looks like.
 *
 * The field names are the awkward ones on purpose. CPEs disagree about all of
 * them — `SerialNumber` in the CWMP spec, `serialNo` in almost everything a
 * human writes — and a route that only accepts one spelling has simply moved the
 * manual step into a text editor.
 */
export function buildInform({
  serialNo,
  vendor = "Huawei",
  model = "MA5800-X7",
  oltId = null,
  ponIndex = "0/1/1:2",
  uptimeSeconds = 42,
  ipAddress = "100.64.0.9",
  serialKey = "serialNo",
} = {}) {
  return {
    [serialKey]: serialNo,
    Vendor: vendor,
    Model: model,
    OLTID: oltId,
    PONPort: ponIndex,
    Uptime: uptimeSeconds,
    IPAddress: ipAddress,
  };
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** Lets a test read the body the adapter sent. */
function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

/**
 * Starts the device side.
 *
 * `rejectNext` is the important switch: the acceptance criterion is that a push
 * which *fails* leaves the database untouched and a retry queued, and that cannot
 * be tested against a device that always says yes.
 */
export async function startMockCpe({ port = 0, reject = false, requireSecret = false } = {}) {
  let nextReject = reject;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/^\/devices\//, "");
    const serial = decodeURIComponent(path.split("/")[0] ?? "");
    const op = path.split("/")[1] ?? "";
    const body = await readBody(req);

    received.push({ serial, op, body });

    // A device management API is not on the public internet, but it is behind a
    // bridge that authenticates it, so the option exists to test that a bridge
    // refusing us is handled like any other device failure.
    if (requireSecret) {
      const want = process.env.MOCK_CPE_SECRET ?? "cpe-secret";
      if ((req.headers.authorization ?? "").replace("Bearer ", "") !== want) {
        return json(res, 401, { error: "the bridge refused this adapter" });
      }
    }

    if (nextReject) {
      nextReject = false;
      // 500, not 404: "the device said no" and "there is no such device" need to
      // be told apart by whoever reads the log.
      return json(res, 500, { error: "the CPE is busy and refused the operation" });
    }

    if (op === "config") {
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        return json(res, 400, { error: "config was not JSON" });
      }
      // Assert the shape here rather than in the test, so a config missing a
      // required field cannot be recorded as a successful provisioning.
      const required = ["pppoeUsername", "pppoePassword", "vlanId", "wifiSsid", "wifiPassword"];
      const missing = required.filter((k) => !parsed[k]);
      if (missing.length) {
        return json(res, 400, { error: `config is missing ${missing.join(", ")}` });
      }
      return json(res, 200, { ok: true, applied: required });
    }

    if (op === "reboot") return json(res, 200, { ok: true, rebooting: true });
    if (op === "factory-reset") return json(res, 200, { ok: true, resetting: true });

    return json(res, 404, { error: "no such operation" });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  const url = `http://127.0.0.1:${actual}`;

  return {
    port: actual,
    url,
    /** Posts an Inform at the ACS route handler, as a booting device does. */
    async inform(opts = {}) {
      const { acs, secret } = opts;
      if (!acs) throw new Error("startMockCpe().inform needs an `acs` base URL");
      const payload = buildInform(opts);
      const res = await fetch(`${acs.replace(/\/$/, "")}/api/acs/inform`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret ?? ""}`,
        },
        body: JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json() };
    },
    /** The last configuration the device was given. */
    lastConfig() {
      const row = [...received].reverse().find((r) => r.op === "config");
      if (!row) return null;
      try {
        return JSON.parse(row.body);
      } catch {
        return null;
      }
    },
    /** Every operation the device has seen. */
    calls: () => received.slice(),
    configs: () => received.filter((r) => r.op === "config").map((r) => JSON.parse(r.body)),
    /** Makes the next operation fail, the way an unreachable or busy device does. */
    rejectNext(value = true) {
      nextReject = value;
    },
    reset: () => {
      received.length = 0;
      nextReject = false;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

/** The module-level record of everything any instance has been told. */
export const allReceived = () => received.slice();

/* ------------------------------------------------------------------ */
/* Command line                                                        */
/* ------------------------------------------------------------------ */

/**
 * Whether this file was run rather than imported.
 *
 * `pathToFileURL` rather than string concatenation: this repository's path
 * contains a space, and `import.meta.url` percent-encodes it. Interpolating
 * `process.argv[1]` produces a URL that never compares equal, so the CLI block
 * below silently did nothing and the documented command appeared to succeed while
 * printing nothing.
 */
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const arg = (name, fallback = undefined) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : fallback;
  };

  const serialNo = arg("inform");
  if (!serialNo) {
    console.error(
      "usage: node tests/mock-acs.mjs --inform <serial> [--acs <base-url>] [--secret <value>]"
    );
    process.exit(2);
  }

  const acs = arg("acs", process.env.ACS_BASE_URL ?? "http://127.0.0.1:3000");
  const secret = arg("secret", process.env.ACS_SECRET ?? "");

  const res = await fetch(`${acs.replace(/\/$/, "")}/api/acs/inform`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(buildInform({ serialNo })),
  });

  console.log(`POST ${acs}/api/acs/inform`);
  console.log(`  -> ${res.status} ${res.statusText}`);
  console.log(JSON.stringify(await res.json(), null, 2));

  if (res.status === 503) {
    console.log(
      "\nThat is the expected answer with TR-069 switched off, or with no shared secret set."
    );
  }
  process.exit(res.ok ? 0 : 1);
}
