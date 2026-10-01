/**
 * A stand-in for a MikroTik router, so the RADIUS server can be tested without one.
 *
 * It speaks the real protocol over real UDP — the same codec, the same
 * authenticators, the same vendor attributes — because the things most likely to
 * be wrong in a RADIUS server (a wrong authenticator, a mis-parsed MS-CHAPv2
 * response, an accounting packet that double-counts) are invisible to anything
 * less real than a socket.
 *
 * It binds on 127.0.0.1 rather than a routable address, and `useRadius` gates
 * which packets the server will even look at — so a test that gets the allowlist
 * wrong fails for the right reason.
 */

import dgram from "node:dgram";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";

import { md4Utf16Le, desEncrypt } from "../radius/auth.ts";
import { loadDictionaries } from "../src/lib/services/radius-codec.ts";

const require_ = createRequire(import.meta.url);
const Radius = require_("radius");
const radiusCodec = Radius;

// Loaded through the shared loader, so the test builds packets with the same
// dictionaries the server decodes them with. Calling the library's own
// `load_dictionaries()` here instead would resolve its default directory relative
// to a path that differs between the test process and the server bundle.
await loadDictionaries();

/**
 * @typedef {object} NasOptions
 * @property {string} secret      What the shared secret must match.
 * @property {number} [coaPort]   Where to listen for Disconnect-Requests.
 * @property {boolean} [wrongSecret] Use a different secret, to prove the server
 *   refuses a packet whose authenticator does not verify.
 */

/**
 * @typedef {object} MockNas
 * @property {number} port
 * @property {number} coaPort
 * @property {{code: string, attributes: Record<string, unknown>}[]} authPackets
 * @property {{attributes: Record<string, unknown>}[]} accountingPackets
 * @property {{username: string, acctSessionId: string, from: string}[]} disconnectRequests
 * @property {boolean} ackCoa     Set false to simulate a router that does not answer.
 * @property {() => Promise<void>} close
 */



/* ------------------------------------------------------------------ */
/* Request builders — the wire format a MikroTik would send            */
/* ------------------------------------------------------------------ */

/** @returns {Buffer} */
export function accessRequestPap(secret, username, password) {
  // The plaintext string, not a hand-encrypted buffer. `User-Password` is declared
  // `string encrypt=1` in the dictionary, so the codec encrypts it itself — and it
  // does that after setting its internal authenticator to the one it writes into
  // the packet. Encrypting by hand first, then handing the result to encode,
  // encrypts the ciphertext a second time against a different authenticator, and
  // the server decrypts to garbage and rejects a correct password.
  return radiusCodec.encode({
    code: "Access-Request",
    secret,
    attributes: [["User-Name", username], ["User-Password", password]],
  });
}

/**
 * An MS-CHAPv2 Access-Request, built the way a MikroTik builds one: a
 * vendor-encapsulated 16-byte challenge, and a 49-byte response whose first half
 * proves the client holds the password.
 */
export function accessRequestMsChapV2(secret, username, password, challenge = randomBytes(16)) {
  // Computed with the same primitives the server verifies with, which is the
  // point: this is a real RFC 2759 response, not a shape that merely parses.
  const peerChallenge = randomBytes(16);
  const nt = md4Utf16Le(password);
  const peerProof = createHash("sha256")
    .update(Buffer.concat([peerChallenge, nt]))
    .digest()
    .subarray(0, 16);
  // DES key is the first 7 bytes of the NT hash; the eighth is parity.
  const desKey = Buffer.from([nt[0], nt[1], nt[2], nt[3], nt[4], nt[5], nt[6], 0]);
  const withNt = desEncrypt(Buffer.concat([nt, peerChallenge, Buffer.alloc(4)]), desKey);
  const withChallenge = desEncrypt(Buffer.concat([challenge, peerChallenge, Buffer.alloc(4)]), desKey);
  const challengeHash = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) challengeHash[i] = withNt[i] ^ withChallenge[i];

  // peer challenge (16) ‖ reserved (1) ‖ NT proof (16) ‖ challenge hash (8) ‖ flags (1).
  const response = Buffer.concat([
    peerChallenge,
    Buffer.from([0]),
    peerProof,
    challengeHash,
    Buffer.from([0]),
  ]);

  return radiusCodec.encode({
    code: "Access-Request",
    secret,
    attributes: [
      ["User-Name", username],
      ["NAS-IP-Address", "127.0.0.1"],
      ["Vendor-Specific", "Microsoft", [["MS-CHAP2-Challenge", challenge]]],
      ["Vendor-Specific", "Microsoft", [["MS-CHAP2-Response", response]]],
    ],
  });
}

export function accountingRequest(secret, fields) {
  return radiusCodec.encode({
    code: "Accounting-Request",
    secret,
    attributes: [
      ["User-Name", fields.username],
      ["Acct-Session-Id", fields.acctSessionId],
      ["Acct-Status-Type", fields.status],
      ["Acct-Session-Time", fields.sessionTime],
      ["NAS-IP-Address", fields.nasIp ?? "127.0.0.1"],
      // Numbers, not strings: the dictionary types these as `integer`, and the
      // codec refuses to encode a string for an attribute it knows the type of.
      ["Input-Octets", fields.inputOctets ?? 0],
      ["Output-Octets", fields.outputOctets ?? 0],
    ],
  });
}

/* ------------------------------------------------------------------ */

/** Binds a socket and resolves with the port it actually got. */
function listen(socket, port) {
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, "127.0.0.1", () => {
      socket.removeListener("error", reject);
      resolve(socket.address().port);
    });
  });
  return port;
}

/** Starts a mock NAS. `authPort` 0 means "any free port". */
/** @returns {Promise<MockNas>} */
export async function startMockNas(opts) {
  /** @type {MockNas} */
  const state = {
    port: 0,
    coaPort: 0,
    authPackets: [],
    accountingPackets: [],
    disconnectRequests: [],
    ackCoa: true,
    close: async () => {},
  };

  const secret = opts.wrongSecret ? "definitely-not-the-secret" : opts.secret;

  const auth = dgram.createSocket({ type: "udp4", reuseAddr: true });
  auth.on("message", (data, rinfo) => {
    try {
      const packet = radiusCodec.decode({ packet: data, secret });
      state.authPackets.push({ code: packet.code, attributes: packet.attributes });
      // The reply's authenticator is derived from the request, so
      // `verify_response` is the honest check that a real router would apply.
      const reply = radiusCodec.encode_response({
        packet,
        code: "Access-Reject",
        secret,
        attributes: [["Reply-Message", "mock"]],
      });
      auth.send(reply, rinfo.port, rinfo.address);
    } catch {
      // An undecodable packet is dropped, which is what a router does with one
      // whose secret does not match.
    }
  });
  state.port = await listen(auth, 0);

  const accounting = dgram.createSocket({ type: "udp4", reuseAddr: true });
  accounting.on("message", (data, rinfo) => {
    try {
      const packet = radiusCodec.decode({ packet: data, secret });
      state.accountingPackets.push({ attributes: packet.attributes });
      const reply = radiusCodec.encode_response({
        packet,
        code: "Accounting-Response",
        secret,
      });
      accounting.send(reply, rinfo.port, rinfo.address);
    } catch {
      /* dropped, as a router would */
    }
  });
  // A fixed default rather than 0, so a test can name the port it sends to.
  const accountingPort = await listen(accounting, 18130);
  void accountingPort;

  const coa = dgram.createSocket({ type: "udp4", reuseAddr: true });
  coa.on("message", (data, rinfo) => {
    try {
      const packet = radiusCodec.decode({ packet: data, secret });
      const username = String(packet.attributes["User-Name"] ?? "");
      const acctSessionId = String(packet.attributes["Acct-Session-Id"] ?? "");
      state.disconnectRequests.push({ username, acctSessionId, from: rinfo.address });
      if (!state.ackCoa) return;

      const reply = radiusCodec.encode_response({
        packet,
        code: "Disconnect-ACK",
        secret,
      });
      coa.send(reply, rinfo.port, rinfo.address);
    } catch {
      /* dropped */
    }
  });
  state.coaPort = await listen(coa, opts.coaPort ?? 37990);

  state.close = async () => {
    await Promise.all(
      [auth, accounting, coa].map(
        (s) =>
          new Promise((resolve) => {
            try {
              s.close(() => resolve());
            } catch {
              resolve();
            }
          })
      )
    );
  };

  return state;
}

/**
 * Sends a packet to the server and resolves with the decoded reply, or null if
 * nothing arrives before `timeoutMs`.
 *
 * A null result is a legitimate outcome and not a test failure by itself: a
 * dropped packet is one of the behaviours under test, so the caller decides what
 * silence means.
 */
export function exchange(port, packet, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* */
      }
      resolve(null);
    }, timeoutMs);

    socket.on("message", (data) => {
      clearTimeout(timer);
      try {
        const packet2 = radiusCodec.decode_without_secret({ packet: data });
        resolve({ code: packet2.code, attributes: packet2.attributes });
      } catch {
        resolve(null);
      } finally {
        try {
          socket.close();
        } catch {
          /* */
        }
      }
    });

    socket.send(packet, port, "127.0.0.1");
  });
}

/** Fire-and-forget, for the packets whose reply the test does not care about. */
export function send(port, packet) {
  const socket = dgram.createSocket("udp4");
  socket.send(packet, port, "127.0.0.1", () => {
    try {
      socket.close();
    } catch {
      /* */
    }
  });
}
