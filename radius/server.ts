/**
 * The RADIUS process: three UDP sockets and the handlers that answer them.
 *
 * Why a separate process rather than a Next.js route handler: RADIUS is UDP, and
 * a UDP request is a single datagram from an address that identifies itself. A
 * route handler has no way to learn the source port of a datagram, cannot bind a
 * second listener, and is behind a TCP HTTP stack that a MikroTik does not speak.
 * Putting this in the web process would also mean an operator's traffic spike
 * slows down authentication, and a bug in an HTTP handler takes the AAA server with
 * it. So it is its own process sharing the database, started with `npm run
 * radius` — see README for the systemd unit.
 *
 * Three listeners, because that is what RFC 2865 and 5176 specify:
 *
 *   1812/udp  Access-Request   — who may get online
 *   1813/udp  Accounting-Request — what they used
 *   3799/udp  Disconnect-Request (sent out; the socket here is the source)
 *
 * Every packet goes through `admitNas` and `decodePacket` before a handler sees
 * it. Nothing in this file decides anything about a customer.
 */

import dgram from "node:dgram";
import {
  admitNas,
  decodePacket,
  encodeResponse,
  loadDictionaries,
  logEvent,
  radiusConfig,
  recordHeartbeatSample,
  writeHeartbeat,
  peekPacket,
  type RadiusConfig,
  type RadiusPacket,
} from "./packet";
import { extractCredentials, decide, acceptAttributes, REPLY_SUSPENDED } from "./auth";
import { readAccountingFields, applyAccounting, type AcctStatusType } from "./accounting";

/** How often the heartbeat is written. The dashboard reads DOWN after 60s. */
const HEARTBEAT_INTERVAL_MS = 15_000;

export type RadiusServer = {
  auth: dgram.Socket;
  accounting: dgram.Socket;
  coa: dgram.Socket;
  config: RadiusConfig;
  /** Counts, for the boot banner and the test assertions. */
  counters: { in: number; out: number };
  stop(): Promise<void>;
  /** Writes a heartbeat immediately rather than waiting for the interval. */
  beat(): Promise<void>;
};

export type StartOptions = {
  config?: RadiusConfig;
  onBeat?: (inPackets: number, outPackets: number) => void;
};

export async function startServer(opts: StartOptions = {}): Promise<RadiusServer> {
  loadDictionaries();
  const config = opts.config ?? (await radiusConfig());

  if (!config.secret) {
    // Refusing to listen is the safe reading. A RADIUS server with no secret
    // accepts nothing, so it produces a support call rather than an outage — but
    // it also binds a port an operator may believe is working. Said plainly here
    // and in the banner.
    throw new Error(
      "No RADIUS shared secret is set (Settings → Network → network.radiusSecret). " +
        "Set it to the same value your routers are configured with, then start the server again."
    );
  }

  const counters = { in: 0, out: 0 };
  const startedAt = new Date();
  const sockets: dgram.Socket[] = [];

  /** Counts one reply, at the single place every reply passes through. */
  const sent = (socket: dgram.Socket, data: Buffer, rinfo: dgram.RemoteInfo) => {
    socket.send(data, rinfo.port, rinfo.address, () => {});
    counters.out += 1;
  };

  const beat = async () => {
    recordHeartbeatSample(counters.in, counters.out, startedAt);
    await writeHeartbeat(counters.in, counters.out, startedAt);
    opts.onBeat?.(counters.in, counters.out);
  };
  await beat();
  const beatTimer = setInterval(() => {
    beat().catch(() => {
      // A failed heartbeat is visible as DOWN, which is the correct reading; it
      // must not take the listeners down with it.
    });
  }, HEARTBEAT_INTERVAL_MS);

  /* ---------------- auth (1812) ---------------- */

  const auth = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sockets.push(auth);
  auth.on("message", (data, rinfo) => {
    counters.in += 1;
    handleAuth(data, rinfo, auth, config, sent).catch((e) => {
      // Never let a handler exception reach the socket layer: an unhandled
      // rejection inside a UDP handler takes the process down and authentication
      // for the whole ISP with it.
      logEvent("dropped", `${rinfo.address}:${rinfo.port} could not be answered: ${describe(e)}`, {
        nasIp: rinfo.address,
      }).catch(() => {});
    });
  });

  /* ---------------- accounting (1813) ---------------- */

  const accounting = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sockets.push(accounting);
  accounting.on("message", (data, rinfo) => {
    counters.in += 1;
    handleAccounting(data, rinfo, accounting, config, sent).catch((e) => {
      logEvent("dropped", `${rinfo.address}:${rinfo.port} accounting could not be handled: ${describe(e)}`, {
        nasIp: rinfo.address,
      }).catch(() => {});
    });
  });

  /* ---------------- CoA listener (3799) ---------------- */

  // The socket this server *sends* Disconnect-Requests from. Binding it is not
  // required for sending, but a router configured to send CoA-Request to us would
  // otherwise get nowhere, and binding gives a clear "address in use" failure at
  // boot rather than a mystery later.
  const coa = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sockets.push(coa);
  coa.on("message", (data, rinfo) => {
    counters.in += 1;
    // Accepted and acknowledged, but not acted on: this phase sends CoA, it does
    // not receive it. Answering rather than dropping is what a router expects, and
    // a logged note means a router configured to send CoA to this host is visible
    // instead of silently failing.
    const decoded = peekPacket(data);
    if (decoded) {
      sent(coa, encodeResponse(decoded, "CoA-ACK", config.secret, []), rinfo);
      logEvent(
        "disconnect",
        `${rinfo.address} sent a ${decoded.code} for ${String(decoded.attributes?.["User-Name"] ?? "an unnamed user")} — acknowledged, but this server only sends CoA and does not act on it`,
        { nasIp: rinfo.address, username: asText(decoded.attributes?.["User-Name"]), outcome: "CoA-ACK" }
      ).catch(() => {});
    }
  });

  await Promise.all([
    bind(auth, config.server, config.authPort),
    bind(accounting, config.server, config.accountingPort),
    bind(coa, config.server, config.coaPort),
  ]);

  return {
    auth,
    accounting,
    coa,
    config,
    counters,
    beat,
    stop: async () => {
      clearInterval(beatTimer);
      await Promise.all(sockets.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    },
  };
}

function bind(socket: dgram.Socket, address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(
      new Error(
        `Could not bind ${address}:${port} — ${e.message}. ` +
          "Another RADIUS process is probably already running, or the port is in use by something else."
      )
    );
    socket.once("error", onError);
    socket.bind(port, address, () => {
      socket.removeListener("error", onError);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Access-Request → Access-Accept or Access-Reject.
 *
 * The reply is always sent, including for a rejected packet, because a silent
 * packet costs the subscriber a 30-second PPPoE timeout before the router gives
 * up — a customer whose line is suspended should be refused quickly, not left
 * waiting.
 */
type Send = (socket: dgram.Socket, data: Buffer, rinfo: dgram.RemoteInfo) => void;

async function handleAuth(
  data: Buffer,
  rinfo: dgram.RemoteInfo,
  socket: dgram.Socket,
  config: RadiusConfig,
  sent: Send
) {
  const admitted = await admitNas(rinfo.address, rinfo.port);
  if (!admitted.ok) {
    // Dropped, not rejected. A Reject is a valid answer to a router we know;
    // answering an unknown one confirms to a prober that a RADIUS server is
    // listening and, since the allowlist is the router table, that a given
    // address is enrolled.
    await logEvent("dropped", admitted.reason, { nasIp: rinfo.address });
    return;
  }

  const decoded = decodePacket(data, config.secret);
  if (!decoded.ok) {
    await logEvent("dropped", `${rinfo.address}: ${decoded.reason}`, { nasIp: rinfo.address });
    return;
  }
  const packet = decoded.packet;
  if (packet.code !== "Access-Request") {
    await logEvent("dropped", `${rinfo.address} sent ${packet.code} to the auth port`, {
      nasIp: rinfo.address,
    });
    return;
  }

  const username = asText(packet.attributes?.["User-Name"]) ?? "";
  sent(socket, await answerAccessRequest(username, packet, config), rinfo);
}

async function answerAccessRequest(
  username: string,
  packet: RadiusPacket,
  config: RadiusConfig
): Promise<Buffer> {
  const creds = extractCredentials(packet);
  const decision = await decide(username, creds);

  if (!decision.allowed) {
    await logEvent(
      "reject",
      `${username || "(no username)"} rejected — ${decision.reason}`,
      { username: username || null, outcome: "Access-Reject" }
    );
    // One message, always, for every rejection. See REPLY_SUSPENDED.
    return encodeResponse(packet, "Access-Reject", config.secret, [["Reply-Message", REPLY_SUSPENDED]]);
  }

  await logEvent(
    "accept",
    `${username} accepted on ${decision.rateLimit ?? "the router's default profile"}`,
    { username, outcome: "Access-Accept" }
  );
  return encodeResponse(packet, "Access-Accept", config.secret, acceptAttributes(decision));
}

/** Accounting-Request → Accounting-Response, always. */
async function handleAccounting(
  data: Buffer,
  rinfo: dgram.RemoteInfo,
  socket: dgram.Socket,
  config: RadiusConfig,
  sent: Send
) {
  const admitted = await admitNas(rinfo.address, rinfo.port);
  if (!admitted.ok) {
    await logEvent("dropped", admitted.reason, { nasIp: rinfo.address });
    return;
  }

  const decoded = decodePacket(data, config.secret);
  if (!decoded.ok) {
    await logEvent("dropped", `${rinfo.address}: ${decoded.reason}`, { nasIp: rinfo.address });
    return;
  }
  const packet = decoded.packet;
  if (packet.code !== "Accounting-Request") {
    await logEvent("dropped", `${rinfo.address} sent ${packet.code} to the accounting port`, {
      nasIp: rinfo.address,
    });
    return;
  }

  const status = asText(packet.attributes?.["Acct-Status-Type"]) as AcctStatusType | null;
  const fields = readAccountingFields(packet, rinfo.address);

  // The reply is sent before the database write, not after. A NAS that does not
  // get an Accounting-Response resends, so making it wait on a query turns a fast
  // path into a retry storm — and the retry then races the first write.
  sent(socket, encodeResponse(packet, "Accounting-Response", config.secret, []), rinfo);

  if (!fields || !status) {
    await logEvent("dropped", `${rinfo.address} sent an Accounting-Request with no username, session id or status`, {
      nasIp: rinfo.address,
    });
    return;
  }

  const outcome = await applyAccounting(fields, status);

  await logEvent(
    "accounting",
    `${fields.username} · ${fields.acctSessionId} · ${status} — ${outcome.detail}`,
    { username: fields.username, nasIp: fields.nasIp, outcome: status }
  );
}

/* ------------------------------------------------------------------ */

function asText(v: unknown): string | null {
  if (typeof v === "string" && v.length) return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return null;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}
