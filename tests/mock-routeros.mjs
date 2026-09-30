/**
 * A stand-in for a MikroTik router, so the client can be tested without one.
 *
 * It speaks the same REST surface the real thing does — `/rest/system/resource`,
 * `/rest/ppp/active`, the address list — including the details that have
 * historically broken the client: durations like `3w2d4h5m6s`, byte counters as
 * decimal strings, and a 401 for the wrong password.
 *
 * Run with:  node --test tests/
 */
import { createServer } from "node:http";

/** The shape a RouterOS resource call returns. */
const RESOURCE = [
  {
    uptime: "3w2d4h5m6s",
    version: "7.14.3 (stable)",
    "cpu-load": 17,
    "free-memory": 268435456,
    "total-memory": 1073741824,
    "board-name": "hEX",
  },
];

/** Two live PPPoE sessions, with the awkward field formats on purpose. */
const PPP_ACTIVE = [
  {
    ".id": "*A",
    name: "rahim100",
    service: "isp-pppoe",
    "caller-id": "64:4C:36:12:AB:01",
    address: "100.64.10.5",
    uptime: "2h14m9s",
    bytesIn: "104857600",
    bytesOut: "12582912",
  },
  {
    ".id": "*B",
    name: "karim200",
    service: "isp-pppoe",
    "caller-id": "64:4C:36:12:AB:02",
    address: "100.64.10.6",
    uptime: "10s",
    bytesIn: "0",
    bytesOut: "0",
  },
];

/** Hotspot sessions, with hotspot's own field names. Empty for the offline case. */
let HOTSPOT_ACTIVE = [
  {
    ".id": "*H1",
    user: "hotspotuser",
    address: "10.5.0.2",
    "mac-address": "64:4C:36:12:AB:03",
    server: "hotspot1",
    uptime: "5m",
    "bytes-in": "1048576",
    "bytes-out": "262144",
  },
];

let addressList = [
  { ".id": "*1", list: "isp-blocked", address: "100.64.10.99" },
];

/**
 * PPP secrets, the mechanism suspension actually works through. The two live
 * sessions above have matching secrets; the third exists with no session, which
 * is the case that matters — a customer suspended while they are offline still
 * has to be locked out of the next login.
 */
let secrets = [
  { ".id": "*S1", name: "rahim100", password: "rahim100", profile: "10Mbps", disabled: "no", service: "isp-pppoe" },
  { ".id": "*S2", name: "karim200", password: "karim200", profile: "25Mbps", disabled: "no", service: "isp-pppoe" },
  { ".id": "*S3", name: "offline300", password: "offline300", profile: "10Mbps", disabled: "no", service: "isp-pppoe" },
];

/** Everything the mock was asked to do, so a test can assert on it. */
export const calls = [];

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export function startMockRouter({
  user = "isp-api",
  password = "correct-horse",
  port = 0,
} = {}) {
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/^\/rest/, "") || "/";
    calls.push({ method: req.method, path });

    // 401 is how RouterOS answers bad credentials.
    if (req.headers.authorization !== expected) {
      return json(res, 401, { error: 401, message: "Unauthorized" });
    }

    // PATCH/PUT bodies arrive on the stream; the mock only needs to know the
    // address so it can behave like the real thing on the next read.
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (path === "/system/resource" && req.method === "GET") {
        return json(res, 200, RESOURCE);
      }
      if (path === "/system/identity" && req.method === "GET") {
        return json(res, 200, [{ name: "isp-core-01" }]);
      }
      if (path === "/ppp/active" && req.method === "GET") {
        return json(res, 200, PPP_ACTIVE);
      }
      if (path === "/ip/hotspot/active" && req.method === "GET") {
        return json(res, 200, HOTSPOT_ACTIVE);
      }
      if (path.startsWith("/ip/hotspot/active/") && req.method === "DELETE") {
        return json(res, 200, {});
      }

      if (path.startsWith("/ppp/active/") && req.method === "DELETE") {
        return json(res, 200, {});
      }

      // /ppp/secret — the enforcement endpoint. RouterOS is a plain REST
      // collection here, so a lookup by name is a client-side find, exactly as
      // the real client has to do it.
      if (path === "/ppp/secret") {
        if (req.method === "GET") return json(res, 200, secrets);
        if (req.method === "PUT") {
          const parsed = JSON.parse(body || "{}");
          const id = `*S${secrets.length + 1}`;
          // RouterOS defaults a new secret to enabled. The mock applies the same
          // default, so a test that forgets to send `disabled` sees what the real
          // device would do rather than an undefined field.
          const row = { ".id": id, disabled: "no", ...parsed };
          secrets.push(row);
          return json(res, 200, row);
        }
      }

      if (path.startsWith("/ppp/secret/")) {
        const id = decodeURIComponent(path.split("/").pop());
        const idx = secrets.findIndex((r) => r[".id"] === id);
        if (idx === -1) {
          return json(res, 404, { error: 404, message: "no such item" });
        }
        if (req.method === "PATCH") {
          const parsed = JSON.parse(body || "{}");
          secrets[idx] = { ...secrets[idx], ...parsed };
          return json(res, 200, secrets[idx]);
        }
        if (req.method === "DELETE") {
          secrets = secrets.filter((r) => r[".id"] !== id);
          return json(res, 200, {});
        }
      }

      if (path === "/ip/firewall/address-list") {
        if (req.method === "GET") return json(res, 200, addressList);
        if (req.method === "PUT") {
          const parsed = JSON.parse(body || "{}");
          const id = `*${addressList.length + 1}`;
          addressList.push({ ".id": id, ...parsed });
          return json(res, 200, { ".id": id, ...parsed });
        }
      }
      if (path.startsWith("/ip/firewall/address-list/")) {
        const id = decodeURIComponent(path.split("/").pop());
        if (req.method === "DELETE") {
          addressList = addressList.filter((r) => r[".id"] !== id);
          return json(res, 200, {});
        }
        if (req.method === "PATCH") return json(res, 200, {});
      }

      return json(res, 404, { error: 404, message: "no such path" });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address();
      resolve({
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        user,
        password,
        addressList: () => addressList,
        secrets: () => secrets.slice(),
        hotspot: () => HOTSPOT_ACTIVE.slice(),
        setHotspot: (rows) => {
          HOTSPOT_ACTIVE = rows;
        },
        /** What happened to one subscriber, so a test can assert on the end state. */
        secret: (name) => secrets.find((r) => r.name === name) ?? null,
        calls: () => calls.slice(),
        reset: () => {
          calls.length = 0;
          addressList = [{ ".id": "*1", list: "isp-blocked", address: "100.64.10.99" }];
          HOTSPOT_ACTIVE = [
            {
              ".id": "*H1",
              user: "hotspotuser",
              address: "10.5.0.2",
              "mac-address": "64:4C:36:12:AB:03",
              server: "hotspot1",
              uptime: "5m",
              "bytes-in": "1048576",
              "bytes-out": "262144",
            },
          ];
          secrets = [
            { ".id": "*S1", name: "rahim100", password: "rahim100", profile: "10Mbps", disabled: "no", service: "isp-pppoe" },
            { ".id": "*S2", name: "karim200", password: "karim200", profile: "25Mbps", disabled: "no", service: "isp-pppoe" },
            { ".id": "*S3", name: "offline300", password: "offline300", profile: "10Mbps", disabled: "no", service: "isp-pppoe" },
          ];
        },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
