/**
 * A stand-in for a MikroTik router, so the RADIUS server can be tested without one.
 *
 * It speaks the real protocol over real UDP — the same codec, the same
 * authenticators, the same vendor attributes — because the things most likely to
 * be wrong in a RADIUS server (an authenticator that verifies against the wrong
 * secret, an MS-CHAPv2 layout that rejects a correct password, an accounting
 * packet that double-counts traffic) are invisible to anything less real than a
 * socket.
 *
 * Every MS-CHAPv2 response here is built **from the RFC's definitions**, written
 * out again rather than by calling the server's own verifier. That is the whole
 * point: a mock that shares code with the thing it is testing proves only that the
 * code is self-consistent, which is exactly the failure this file exists to catch.
 * When the two disagree, the server is wrong.
 */

import dgram from "node:dgram";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";

const require_ = createRequire(import.meta.url);
const radiusCodec = require_("radius");
const CryptoJS = require_("crypto-js");

// Vendor dictionaries, so an Access-Request can carry MS-CHAPv2 exactly as a
// MikroTik builds it, and the reply can carry MS-CHAP2-Success. Loaded through the
// shared loader so the test builds packets with the same dictionaries the server
// decodes them with.
const { loadDictionaries } = await import("../src/lib/services/radius-codec.ts");
await loadDictionaries();

/**
 * @typedef {object} NasOptions
 * @property {string} secret          What the shared secret must match.
 * @property {number} [coaPort]       Where to listen for Disconnect-Requests.
 * @property {boolean} [wrongSecret]  Use a different secret, to prove the server
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
/* PAP / CHAP                                                          */
/* ------------------------------------------------------------------ */

/**
 * An Access-Request carrying PAP.
 *
 * The plaintext string, not a hand-encrypted buffer. `User-Password` is declared
 * `string encrypt=1` in the dictionary, so the codec encrypts it itself — and it
 * does that after setting its internal authenticator to the one it writes into
 * the packet. Encrypting by hand first, then handing the result to encode,
 * encrypts the ciphertext a second time against a different authenticator, and the
 * server decrypts to garbage and rejects a correct password.
 *
 * @returns {Buffer}
 */
export function accessRequestPap(secret, username, password) {
  return radiusCodec.encode({
    code: "Access-Request",
    secret,
    attributes: [["User-Name", username], ["User-Password", password]],
  });
}

/**
 * An MS-CHAPv2 Access-Request, built per RFC 2759 §4 and §8.1.
 *
 * The authenticator's challenge is carried in **MS-CHAP-Challenge** (vendor 311,
 * type 11), which is what a MikroTik sends; there is no MS-CHAP2-Challenge
 * attribute. The 16-byte peer challenge is chosen by the caller so a test can pin
 * the whole exchange to a known-good vector.
 *
 * @returns {Buffer}
 */
export function accessRequestMsChapV2(
  secret,
  username,
  password,
  authenticatorChallenge = randomBytes(16),
  peerChallenge = randomBytes(16)
) {
  const value = msChapV2ResponseValue(password, authenticatorChallenge, peerChallenge, username);

  return radiusCodec.encode({
    code: "Access-Request",
    secret,
    attributes: [
      ["User-Name", username],
      ["NAS-IP-Address", "127.0.0.1"],
      ["Vendor-Specific", "Microsoft", [["MS-CHAP-Challenge", authenticatorChallenge]]],
      ["Vendor-Specific", "Microsoft", [["MS-CHAP2-Response", value]]],
    ],
  });
}

/**
 * The 49-octet MS-CHAP2-Response value: Ident ‖ Flags ‖ PeerChallenge ‖
 * Reserved ‖ NTResponse.
 *
 * Built from the RFC's own definitions, transcribed a second time. If this and
 * `radius/auth.ts` disagree, one of them is not RFC 2759.
 */
export function msChapV2ResponseValue(password, authenticatorChallenge, peerChallenge, username) {
  // RFC 2759 §8.1: ChallengeHash = SHA-1(Peer ‖ Authenticator ‖ UserName)[0..8]
  const challengeHash = createHash("sha1")
    .update(Buffer.concat([peerChallenge, authenticatorChallenge, Buffer.from(username, "ascii")]))
    .digest()
    .subarray(0, 8);

  // RFC 2759 §8.1: NtPasswordHash = MD4(UTF-16LE(password)). MD4 is not available
  // from node:crypto, so the caller supplies it rather than this file pretending
  // to be an independent check of it — the MD4 is verified separately against the
  // RFC 1320 vectors.
  const ntHash = md4Utf16LeForTest(password);

  // Three 56-bit keys at *bit* offsets 0, 56 and 112 of the 128-bit hash, zero
  // padded. A DES key holds seven significant bits per octet with the eighth as
  // parity, which is why this is a bit stream and not three byte slices.
  const bits = [];
  for (const byte of ntHash) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  while (bits.length < 168) bits.push(0);

  const parts = [];
  for (let block = 0; block < 3; block++) {
    const key = Buffer.alloc(8);
    for (let o = 0; o < 8; o++) {
      let v = 0;
      for (let j = 0; j < 7; j++) v = (v << 1) | bits[block * 56 + o * 7 + j];
      key[o] = v << 1;
    }
    parts.push(des(key, challengeHash));
  }

  return Buffer.concat([
    Buffer.from([1, 0]), // Ident, Flags
    peerChallenge,
    Buffer.alloc(8), // Reserved, zero
    ...parts,
  ]);
}

/**
 * DES of one 8-byte block.
 *
 * Via `crypto-js`, which is a direct dependency — the same library the server
 * uses, and the one checked against the FIPS 81 vectors. Hand-rolling DES here
 * would be the error this whole file is written to catch.
 */
function des(key8, block8) {
  return Buffer.from(
    CryptoJS.DES.encrypt(CryptoJS.enc.Hex.parse(block8.toString("hex")),
      CryptoJS.enc.Hex.parse(key8.toString("hex")),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
    ).ciphertext.toString(),
    "hex"
  );
}

/* ------------------------------------------------------------------ */
/* Accounting                                                          */
/* ------------------------------------------------------------------ */

/**
 * An Accounting-Request.
 *
 * The octet counters are numbers, not strings: the dictionary types them as
 * `integer`, and the codec refuses to encode a string for an attribute it knows
 * the type of.
 *
 * @returns {Buffer}
 */
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
      ["Input-Octets", fields.inputOctets ?? 0],
      ["Output-Octets", fields.outputOctets ?? 0],
    ],
  });
}

/* ------------------------------------------------------------------ */
/* The NAS itself                                                      */
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
}

/** Starts a mock NAS. @returns {Promise<MockNas>} */
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
      const reply = radiusCodec.encode_response({ packet, code: "Accounting-Response", secret });
      accounting.send(reply, rinfo.port, rinfo.address);
    } catch {
      /* dropped, as a router would */
    }
  });
  await listen(accounting, 18130);

  const coa = dgram.createSocket({ type: "udp4", reuseAddr: true });
  coa.on("message", (data, rinfo) => {
    try {
      const packet = radiusCodec.decode({ packet: data, secret });
      state.disconnectRequests.push({
        username: String(packet.attributes["User-Name"] ?? ""),
        acctSessionId: String(packet.attributes["Acct-Session-Id"] ?? ""),
        from: rinfo.address,
      });
      if (!state.ackCoa) return;
      const reply = radiusCodec.encode_response({ packet, code: "Disconnect-ACK", secret });
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
 * Sends a packet and resolves with the decoded reply, or null if nothing arrives
 * before `timeoutMs`.
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
        socket.close();
      } catch {
        /* */
      }
      try {
        const reply = radiusCodec.decode_without_secret({ packet: data });
        resolve({ code: reply.code, attributes: reply.attributes });
      } catch {
        resolve(null);
      }
    });
    socket.send(packet, port, "127.0.0.1");
  });
}

/** Fire-and-forget, for packets whose reply the test does not care about. */
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

/**
 * MD4 over the UTF-16LE encoding of `text`.
 *
 * Duplicated from the server's implementation on purpose, for the reason given at
 * the top of this file: the mock must not call the code it is checking. The two
 * agreeing is then evidence, and the RFC 1320 vectors are what make it evidence.
 */
function md4Utf16LeForTest(text) {
  return md4(Buffer.from(text, "utf16le"));
}

const M4 = 0xffffffff;
const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) & M4;

function md4(buf) {
  const bitLength = BigInt(buf.length * 8);
  const bytes = [...buf, 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Number((bitLength >> BigInt(i * 8)) & 0xffn));
  const padded = Buffer.from(bytes);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const F = (x, y, z) => ((x & y) | (~x & z)) & M4;
  const G = (x, y, z) => ((x & y) | (x & z) | (y & z)) & M4;
  const H = (x, y, z) => (x ^ y ^ z) & M4;
  const S1 = [3, 7, 11, 19], S2 = [3, 5, 9, 13], S3 = [3, 9, 11, 15];
  const K2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
  const K3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

  for (let o = 0; o < padded.length; o += 64) {
    const X = [];
    for (let i = 0; i < 16; i++) X.push(padded.readUInt32LE(o + i * 4));
    let A = a0, B = b0, C = c0, D = d0;

    for (let g = 0; g < 4; g++) {
      A = rotl((A + F(B, C, D) + X[g * 4]) & M4, S1[0]);
      D = rotl((D + F(A, B, C) + X[g * 4 + 1]) & M4, S1[1]);
      C = rotl((C + F(D, A, B) + X[g * 4 + 2]) & M4, S1[2]);
      B = rotl((B + F(C, D, A) + X[g * 4 + 3]) & M4, S1[3]);
    }
    for (let g = 0; g < 4; g++) {
      A = rotl((A + G(B, C, D) + X[K2[g * 4]] + 0x5a827999) & M4, S2[0]);
      D = rotl((D + G(A, B, C) + X[K2[g * 4 + 1]] + 0x5a827999) & M4, S2[1]);
      C = rotl((C + G(D, A, B) + X[K2[g * 4 + 2]] + 0x5a827999) & M4, S2[2]);
      B = rotl((B + G(C, D, A) + X[K2[g * 4 + 3]] + 0x5a827999) & M4, S2[3]);
    }
    for (let g = 0; g < 4; g++) {
      A = rotl((A + H(B, C, D) + X[K3[g * 4]] + 0x6ed9eba1) & M4, S3[0]);
      D = rotl((D + H(A, B, C) + X[K3[g * 4 + 1]] + 0x6ed9eba1) & M4, S3[1]);
      C = rotl((C + H(D, A, B) + X[K3[g * 4 + 2]] + 0x6ed9eba1) & M4, S3[2]);
      B = rotl((B + H(C, D, A) + X[K3[g * 4 + 3]] + 0x6ed9eba1) & M4, S3[3]);
    }

    a0 = (a0 + A) & M4; b0 = (b0 + B) & M4; c0 = (c0 + C) & M4; d0 = (d0 + D) & M4;
  }

  const out = Buffer.alloc(16);
  out.writeUInt32LE(a0 >>> 0, 0);
  out.writeUInt32LE(b0 >>> 0, 4);
  out.writeUInt32LE(c0 >>> 0, 8);
  out.writeUInt32LE(d0 >>> 0, 12);
  return out;
}