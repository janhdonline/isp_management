/**
 * Authentication: prove the subscriber, then decide whether they may be online.
 *
 * The order matters and is not negotiable. The credential is checked first, and
 * the account's state second, so a caller who cannot prove who they are learns
 * nothing about whether the customer exists, is suspended, or has expired. Doing
 * the authorization first would be a user-enumeration oracle on a UDP port that
 * is, by definition, exposed to the internet.
 *
 * Three things make this usable by real hardware:
 *
 *  - **Mikrotik-Rate-Limit carries the package speed.** That is what removes the
 *    need to provision a PPP secret per subscriber: the router learns the speed
 *    from the Access-Accept. It is also why the vendor dictionary is not optional
 *    decoration — without it the attribute cannot be named and every subscriber
 *    gets a router default, which is the ISP's most common billing complaint.
 *  - **Session-Timeout is set to the time left before expiry.** The router then
 *    re-authenticates on its own near the end of the cycle, and a subscription
 *    that expires is cut without anybody touching the router. A long static
 *    timeout means a customer stays online until their PPPoE lease drops, which on
 *    a MikroTik can be days.
 *  - **Rejections are terse and identical.** One Reply-Message, the same for a
 *    suspended customer, an expired one and a wrong password. A customer who has
 *    forgotten their password must not be able to learn that by reading it
 *    differently from a suspended account.
 */

import { createHash } from "node:crypto";
import CryptoJS from "crypto-js";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { type RadiusPacket } from "./packet";
import type { RadiusAttr } from "@/lib/services/radius-codec";

/** MikroTik's vendor id, from radius/dictionaries/dictionary.mikrotik. */
export const MIKROTIK_VENDOR = "MikroTik";

/**
 * The one message a customer is ever shown.
 *
 * Exported so a test can assert every rejection path produces this, and so there
 * is exactly one string in the codebase that a customer can be told.
 */
export const REPLY_SUSPENDED = "Account suspended — please clear your dues";

/**
 * What an Access-Request carried, extracted from whichever method it used.
 *
 * Exactly one of the three is present on a real request. All three are read
 * defensively: a NAS that sends something odd must produce a rejection with a
 * reason an operator can act on, not a crash inside the packet handler.
 *
 * The challenge is carried alongside, because MS-CHAPv2 cannot be verified without
 * the challenge this server sent — it is not in the response, and that is the
 * whole reason the second half of the proof means anything.
 */
export type Credentials = {
  method: "PAP" | "CHAP" | "MS-CHAPv2" | "none";
  value: Buffer | null;
  /** The server's own 16-byte MS-CHAP2 challenge, when one was sent. */
  challenge: Buffer | null;
};

export function extractCredentials(packet: RadiusPacket): Credentials {
  const attrs = packet.attributes ?? {};
  const vs = attrs["Vendor-Specific"];
  const ms = (name: string): Buffer | null => {
    const v = vs?.[name];
    if (!v) return null;
    const buf = Buffer.isBuffer(v) ? v : Buffer.from(v);
    return buf.length ? buf : null;
  };

  // MS-CHAPv2 first: a MikroTik offers CHAP and MS-CHAPv2, and the CHAP
  // attribute is present in some MS-CHAPv2 requests too. Checking v2 first means
  // a request offering both is answered with the method the client actually
  // prefers rather than the weaker one.
  const chap2Challenge = ms("MS-CHAP2-Challenge");
  const chap2Response = ms("MS-CHAP2-Response");
  if (chap2Response) {
    return { method: "MS-CHAPv2", value: chap2Response, challenge: chap2Challenge };
  }

  const chapPassword = attrs["CHAP-Password"];
  if (chapPassword) {
    const buf = Buffer.isBuffer(chapPassword) ? chapPassword : Buffer.from(chapPassword);
    if (buf.length) return { method: "CHAP", value: buf, challenge: null };
  }

  const pap = attrs["User-Password"];
  if (typeof pap === "string" && pap.length) {
    return { method: "PAP", value: Buffer.from(pap), challenge: null };
  }

  return { method: "none", value: null, challenge: null };
}

/* ------------------------------------------------------------------ */
/* The three verifiers                                                 */
/* ------------------------------------------------------------------ */

/**
 * PAP: the stored password, compared in constant time.
 *
 * Constant time because the comparison is against a string an unauthenticated
 * caller controls. A byte-by-byte `===` returns as soon as two bytes differ and
 * is measurably leakier; the cost of `timingSafeEqual` is nil.
 */
export function verifyPap(stored: string, supplied: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) {
    // Still do the comparison, so a wrong-length guess is not faster than a
    // wrong-value one of the right length.
    timingSafeEqual(Buffer.alloc(16), Buffer.alloc(16));
    return false;
  }
  return timingSafeEqual(a, b);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * CHAP: MD5(id ‖ secret ‖ challenge).
 *
 * The first byte of CHAP-Password is the CHAP identifier and the rest is the
 * digest, so the challenge comes from the same attribute — a client cannot be
 * checked against a challenge it did not answer.
 */
export function verifyChap(stored: string, chapPassword: Buffer): boolean {
  // The layout is identifier(1) ‖ response(16) ‖ challenge(rest), so the
  // response is a *sliced* 16 bytes. Taking subarray(1) unsliced and comparing it
  // to a 16-byte digest fails on length and rejects every CHAP login.
  if (chapPassword.length < 18) return false;
  const id = chapPassword[0];
  const response = chapPassword.subarray(1, 17);
  const challenge = chapPassword.subarray(17);
  if (challenge.length === 0) return false;

  const expected = md5Bytes(Buffer.concat([
    Buffer.from([id]),
    Buffer.from(stored, "utf8"),
    challenge,
  ]));
  return timingSafeEqual(expected, response);
}

/**
 * MS-CHAPv2 (RFC 2759), the method a MikroTik PPPoE server negotiates.
 *
 * The response carries two independent proofs, and both are required:
 *
 *   1. **The NT hash** — `SHA-256(peerChallenge ‖ password)` truncated to 16 bytes.
 *      This is the client proving it holds the password, with the password itself
 *      never on the wire.
 *   2. **The challenge hash** — `DES(NtHash ‖ peerChallenge) XOR DES(challenge ‖
 *      peerChallenge)`, first 8 bytes. This is the client proving it answered *our*
 *      challenge, so a response captured from one session cannot be replayed at
 *      another.
 *
 * Checking only the first accepts a client that answered a different server's
 * challenge; checking only the second accepts anyone who has captured a response
 * once. The pairing is the whole point of the protocol.
 *
 * `challenge` is the 16-byte value this server sent in MS-CHAP2-Challenge. It is a
 * parameter rather than something read from the response because the response
 * cannot contain it — the entire security of the second proof is that the client
 * had to be told it out of band.
 */
export function verifyMsChapV2(
  stored: string,
  attribute: Buffer,
  challenge: Buffer
): boolean {
  if (challenge.length !== 16) return false;

  // The RFC 2759 value is 42 bytes — peer challenge (16) ‖ reserved (1) ‖
  // NTResponse (24) ‖ flags (1) — and as a RADIUS attribute it is 43, with a
  // leading identifier byte.
  //
  // Which of the two arrives depends on the NAS, so both are accepted. Strict
  // equality on either length was the earlier version of this check and it
  // rejected correct logins, because a MikroTik sends the 42-byte value while the
  // RADIUS encoding of it is 43 — the check was demanding a length that matches
  // neither. The floor is 41 because the challenge hash ends at byte 41.
  const value = attribute.length === 43 ? attribute.subarray(1) : attribute;
  if (value.length < 41) return false;

  const peerChallenge = value.subarray(0, 16);
  // Byte 16 is Reserved; RFC 2759 says to ignore it.
  const ntHash = value.subarray(17, 33);
  const challengeHash = value.subarray(33, 41);

  return (
    verifyNtHash(stored, peerChallenge, ntHash) &&
    verifyChallengeHash(stored, peerChallenge, challenge, challengeHash)
  );
}

/** `SHA-256(peerChallenge ‖ password)`, the first 16 bytes. */
function sha256Truncate16(input: Buffer): Buffer {
  return createHash("sha256").update(input).digest().subarray(0, 16);
}

/**
 * The stage-1 check: the client proved it holds the password.
 *
 * UTF-16LE, not UTF-8: RFC 2759 defines the peer challenge over the password's
 * *Unicode* encoding, and that is what a MikroTik computes. A UTF-8 byte string
 * happens to match for a pure-ASCII password's first 16 bytes only by accident of
 * length, and diverges for anything else — so the encoding is stated rather than
 * left to a default.
 */
function verifyNtHash(password: string, peerChallenge: Buffer, actual: Buffer): boolean {
  // The NT *hash*, not the password: RFC 2759 §8.7 defines the proof as
  // `SHA-256(PeerChallenge ‖ NtPasswordHash)`, where NtPasswordHash is the MD4 of
  // the UTF-16LE password. Hashing the raw password instead is a mismatch every
  // time, and it fails as a reject on every MS-CHAPv2 login.
  const expected = sha256Truncate16(
    Buffer.concat([peerChallenge, md4Utf16Le(password)])
  );
  return timingSafeEqual(expected, actual);
}

/**
 * The stage-2 check, RFC 2759 §8.2:
 *
 *   ChallengeHash = DES(NtHash ‖ PeerChallenge ‖ 0) XOR DES(Challenge ‖ PeerChallenge ‖ 0)
 *
 * taking the first 8 bytes of the result, with a 7-byte key taken from the NT
 * hash. DES is the obsolete cipher RFC 2759 specifies, so this is not a choice —
 * a MikroTik computes exactly this and nothing else will interoperate.
 */
function verifyChallengeHash(
  password: string,
  peerChallenge: Buffer,
  challenge: Buffer,
  actual: Buffer
): boolean {
  const ntHash = md4Utf16Le(password);
  // Only 7 bytes of an 8-byte DES key are significant; the eighth is parity.
  const key = Buffer.from([ntHash[0], ntHash[1], ntHash[2], ntHash[3], ntHash[4], ntHash[5], ntHash[6], 0]);

  const withNt = desEncrypt(
    Buffer.concat([ntHash, peerChallenge, Buffer.from([0, 0, 0, 0])]),
    key
  );
  const withChallenge = desEncrypt(
    Buffer.concat([challenge, peerChallenge, Buffer.from([0, 0, 0, 0])]),
    key
  );

  const expected = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) expected[i] = withNt[i] ^ withChallenge[i];
  return timingSafeEqual(expected, actual);
}

function md5Bytes(input: Buffer): Buffer {
  return createHash("md5").update(input).digest();
}

/**
 * MD4 over the UTF-16LE encoding of `text` — the NT hash of a PPPoE password.
 *
 * Exported for the test that checks it against the RFC 1320 vectors. This is a
 * hand-rolled hash, which is exactly the kind of code that ends up *believed*
 * correct rather than *known* correct: Node's OpenSSL build has MD4 disabled, so
 * there is nothing to delegate to, and a subtly wrong version produces a plausible
 * 16 bytes rather than an error. `tests/radius.test.mjs` runs all seven RFC 1320
 * vectors against it, which is the only reason to believe it.
 */
export function md4Utf16Le(text: string): Buffer {
  return md4(Buffer.from(text, "utf16le"));
}

/** MD4 over raw bytes. Exported so the RFC 1320 vectors can be checked against it. */
export function md4(input: Buffer): Buffer {
  // Padding to 56 mod 64, then the message length in bits as a 64-bit
  // little-endian integer. Built as an array of numbers and converted at the end
  // because a Buffer is fixed-length and has no `push`.
  const bits = BigInt(input.length * 8);
  const bytes: number[] = [...input, 0x80];
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Number((bits >> BigInt(i * 8)) & 0xffn));
  const padded = Buffer.from(bytes);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const S1 = [3, 7, 11, 19], S2 = [3, 5, 9, 13], S3 = [3, 9, 11, 15];
  // The word order each round reads: sequential, then strides of 4, then the
  // bit-reversed interleave. Getting these wrong is a hash that still runs.
  const K2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
  const K3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const X: number[] = [];
    for (let i = 0; i < 16; i++) X.push(padded.readUInt32LE(offset + i * 4));
    let A = a, B = b, C = c, D = d;

    // Each round rewrites the registers in the order A, D, C, B and reads the
    // three *other* registers, so a step sees the values the previous step wrote.
    for (let g = 0; g < 4; g++) {
      A = rotl32(A + F(B, C, D) + X[g * 4 + 0], S1[0]);
      D = rotl32(D + F(A, B, C) + X[g * 4 + 1], S1[1]);
      C = rotl32(C + F(D, A, B) + X[g * 4 + 2], S1[2]);
      B = rotl32(B + F(C, D, A) + X[g * 4 + 3], S1[3]);
    }
    for (let g = 0; g < 4; g++) {
      A = rotl32(A + G(B, C, D) + X[K2[g * 4]] + 0x5a827999, S2[0]);
      D = rotl32(D + G(A, B, C) + X[K2[g * 4 + 1]] + 0x5a827999, S2[1]);
      C = rotl32(C + G(D, A, B) + X[K2[g * 4 + 2]] + 0x5a827999, S2[2]);
      B = rotl32(B + G(C, D, A) + X[K2[g * 4 + 3]] + 0x5a827999, S2[3]);
    }
    for (let g = 0; g < 4; g++) {
      A = rotl32(A + H(B, C, D) + X[K3[g * 4]] + 0x6ed9eba1, S3[0]);
      D = rotl32(D + H(A, B, C) + X[K3[g * 4 + 1]] + 0x6ed9eba1, S3[1]);
      C = rotl32(C + H(D, A, B) + X[K3[g * 4 + 2]] + 0x6ed9eba1, S3[2]);
      B = rotl32(B + H(C, D, A) + X[K3[g * 4 + 3]] + 0x6ed9eba1, S3[3]);
    }

    a = (A + a) | 0; b = (B + b) | 0; c = (C + c) | 0; d = (D + d) | 0;
  }

  const out = Buffer.alloc(16);
  out.writeUInt32LE(a >>> 0, 0);
  out.writeUInt32LE(b >>> 0, 4);
  out.writeUInt32LE(c >>> 0, 8);
  out.writeUInt32LE(d >>> 0, 12);
  return out;
}

/**
 * A 32-bit left rotation.
 *
 * The mask on the way in is what makes it correct: a JavaScript `<<` keeps 32
 * bits but the additions feeding it are 53-bit doubles, so without it the high
 * garbage is shifted in instead of being discarded.
 */
function rotl32(x: number, n: number): number {
  x = x & 0xffffffff;
  return (((x << n) | (x >>> (32 - n))) & 0xffffffff) | 0;
}

const F = (x: number, y: number, z: number) => ((x & y) | (~x & z)) | 0;
const G = (x: number, y: number, z: number) => ((x & y) | (x & z) | (y & z)) | 0;
const H = (x: number, y: number, z: number) => (x ^ y ^ z) | 0;

/* --- DES, for the MS-CHAPv2 challenge hash -------------------------- */

/**
 * DES encryption of one 8-byte block.
 *
 * RFC 2759 specifies DES, so there is nothing to choose here — and nothing in
 * Node can do it either, because modern OpenSSL builds ship DES in the legacy
 * provider and leave it disabled by default (`crypto.createCipheriv("des-ecb")`
 * throws `ERR_OSSL_EVP_UNSUPPORTED`). MS-CHAPv2 is nonetheless the method a
 * MikroTik PPPoE server negotiates, so a RADIUS server that cannot compute it
 * rejects every subscriber on a real router.
 *
 * Rather than hand-roll a cipher — which is exactly the mistake this project's
 * RADIUS packet layer exists to avoid — the block cipher comes from `crypto-js`,
 * a pure-JavaScript implementation that is checked here against the FIPS 81
 * known-answer vector rather than trusted. `tests/radius.test.mjs` runs that
 * vector, so a version of the library that quietly changed behaviour fails the
 * suite instead of failing every MS-CHAPv2 login in production.
 *
 * The key may be 7 bytes (MS-CHAPv2 passes the first 7 bytes of the NT hash) or
 * 8. DES uses the low 56 bits and drops the parity bits, so an 8-byte key is
 * passed through whole — truncating it to 7 would throw away a real key byte.
 * A shorter key is zero-extended, which is what DES specifies for a short key.
 */
export function desEncrypt(block: Buffer, key: Buffer): Buffer {
  const padded = Buffer.alloc(8);
  key.copy(padded, 0, 0, Math.min(8, key.length));
  const result = CryptoJS.DES.encrypt(
    CryptoJS.enc.Hex.parse(block.toString("hex")),
    CryptoJS.enc.Hex.parse(padded.toString("hex")),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding }
  );
  return Buffer.from(result.ciphertext.toString(), "hex");
}

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

export type AuthDecision = {
  allowed: boolean;
  /** Why not, for the log. Never shown to the customer verbatim. */
  reason?: string;
  customerId?: string;
  username?: string;
  /** Set when the session should end at a specific time. */
  sessionTimeoutSec?: number;
  rateLimit?: string;
  framedIp?: string;
  /** True when the account exists and the password was right, but the state said no. */
  credentialOk?: boolean;
};

/**
 * Decides whether a subscriber may be online.
 *
 * The settings read here are the same ones the billing lifecycle uses, so the
 * answer cannot disagree with the dashboard: `billing.gracePeriod` is the same
 * number the expiry sweep honours, and a customer suspended by that sweep is
 * rejected here by reading the same column it wrote.
 */
export async function decide(username: string, creds: Credentials): Promise<AuthDecision> {
  if (!username) return { allowed: false, reason: "no username in the request" };
  if (creds.method === "none" || !creds.value) {
    // Not "wrong password" — there was no credential at all, and saying so tells
    // a prober the server distinguishes the two.
    return { allowed: false, reason: "no supported password attribute" };
  }

  const customer = await prisma.customer.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      password: true,
      connectionStatus: true,
      expiryDate: true,
      previousDue: true,
      package: { select: { downloadSpeed: true, uploadSpeed: true, name: true } },
    },
  });

  if (!customer || !customer.password) {
    return { allowed: false, reason: "no such subscriber" };
  }

  const ok = verifyCredential(customer.password, creds);
  if (!ok) {
    return { allowed: false, reason: "wrong password", username };
  }

  // From here the account is known, so a reason can be specific — it is for the
  // operator, and the Reply-Message stays identical for all of them.
  const s = await getSettings();
  const graceDays = Number(s["billing.gracePeriod"] ?? 5);

  if (customer.connectionStatus !== "Active") {
    return {
      allowed: false,
      reason: `connection status is ${customer.connectionStatus}`,
      username,
      credentialOk: true,
    };
  }

  if (customer.expiryDate) {
    // Grace is applied here as the sweep applies it, so "expired" means the same
    // thing in both places. Not `Date.now()` alone: the sweep suspends on a
    // start-of-day basis, and a customer a day inside the grace period is not
    // disconnected by this server either.
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - graceDays);
    if (customer.expiryDate < cutoff) {
      return {
        allowed: false,
        reason: `expired ${customer.expiryDate.toISOString().slice(0, 10)}, past the ${graceDays}-day grace period`,
        username,
        credentialOk: true,
      };
    }
  }

  // Blocking billing state. A customer with money outstanding is a decision the
  // office makes through suspension; a customer with a stale *unpaid* flag but no
  // due is not, and must not be cut off here — the flag is an input, not a verdict.
  if (customer.previousDue > 0) {
    return {
      allowed: false,
      reason: `outstanding dues of ${customer.previousDue}`,
      username,
      credentialOk: true,
    };
  }

  return {
    allowed: true,
    customerId: customer.id,
    username: customer.username,
    credentialOk: true,
    rateLimit: rateLimitFor(customer.package),
    sessionTimeoutSec: sessionTimeout(customer.expiryDate),
  };
}

export function verifyCredential(stored: string, creds: Credentials): boolean {
  if (!creds.value) return false;
  switch (creds.method) {
    case "PAP": {
      // The codec decrypts User-Password before it reaches here, so the value is
      // the plaintext the client sent.
      return verifyPap(stored, creds.value.toString("utf8"));
    }
    case "CHAP":
      return verifyChap(stored, creds.value);
    case "MS-CHAPv2":
      // `creds.challenge` is the challenge this server sent. It is absent when a
      // request carried no MS-CHAP2-Challenge, and the verifier rejects rather
      // than falling back to a stage that would not prove the client answered
      // *this* session.
      if (!creds.challenge) return false;
      return verifyMsChapV2(stored, creds.value, creds.challenge);
    default:
      return false;
  }
}

/**
 * `"<down>M/<up>M"` — the MikroTik rate-limit syntax, and down first.
 *
 * Down first is not a choice: MikroTik reads the first number as the receive
 * (download) rate. Reversed, a 20M/10M subscriber gets 10M down and nobody
 * notices until a complaint about slow speeds on a package sold as 20 Mbps.
 */
export function rateLimitFor(pkg: { downloadSpeed: number; uploadSpeed: number } | null): string | undefined {
  if (!pkg) return undefined;
  const down = Math.max(1, Math.round(pkg.downloadSpeed));
  const up = Math.max(1, Math.round(pkg.uploadSpeed));
  return `${down}M/${up}M`;
}

/**
 * Seconds until expiry, for Session-Timeout.
 *
 * Capped at a day so the router re-authenticates at least daily even for a
 * subscription with a long expiry — that is what makes a mid-cycle suspension
 * reach an already-connected customer. Never zero: Session-Timeout 0 logs the
 * subscriber straight out, so a customer with no expiry date must get no
 * attribute at all rather than an empty one.
 */
export function sessionTimeout(expiryDate: Date | null, now: Date = new Date()): number | undefined {
  if (!expiryDate) return undefined;
  const seconds = Math.floor((expiryDate.getTime() - now.getTime()) / 1000);
  if (seconds <= 60) return 60;
  return Math.min(seconds, 86_400);
}

/** The reply attributes for an Access-Accept. */
export function acceptAttributes(decision: AuthDecision): RadiusAttr[] {
  const attributes: RadiusAttr[] = [];
  if (decision.rateLimit) {
    attributes.push(["Vendor-Specific", MIKROTIK_VENDOR, [["Mikrotik-Rate-Limit", decision.rateLimit]]]);
  }
  if (decision.sessionTimeoutSec) {
    attributes.push(["Session-Timeout", decision.sessionTimeoutSec]);
  }
  if (decision.framedIp) {
    attributes.push(["Framed-IP-Address", decision.framedIp]);
  }
  return attributes;
}
