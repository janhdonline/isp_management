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

/** Microsoft's vendor id (PEN 311), from radius/dictionaries/dictionary.mschap2. */
export const MICROSOFT_VENDOR = "Microsoft";

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
  /**
   * The authenticator's 16-byte challenge, read from the request's
   * MS-CHAP-Challenge attribute (RFC 2548 type 11).
   *
   * There is no MS-CHAP2-Challenge attribute — a server that "sends" one under
   * that name is not interoperable, and this one reads what actually arrived
   * rather than inventing a value, because the challenge hash is only meaningful
   * if the client was told it.
   */
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
  const chap2Response = ms("MS-CHAP2-Response");
  if (chap2Response) {
    return { method: "MS-CHAPv2", value: chap2Response, challenge: ms("MS-CHAP-Challenge") };
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

/* ------------------------------------------------------------------ */
/* MS-CHAPv2 (RFC 2759)                                                */
/* ------------------------------------------------------------------ */

/**
 * The MS-CHAP2-Response value, excluding the RADIUS length header:
 * 1 + 1 + 16 + 8 + 24 = 50 octets. As a RADIUS attribute it is 51.
 */
const MS_CHAP2_RESPONSE_LEN = 50;

/**
 * Verifies an MS-CHAPv2 (RFC 2759) response.
 *
 * RFC 2759 §4 fixes the value's layout:
 *
 *     1 octet   Ident
 *     1 octet   Flags
 *    16 octets  PeerChallenge
 *     8 octets  Reserved, must be zero
 *    24 octets  NTResponse
 *
 * 50 octets in total, and as a RADIUS attribute a leading length byte makes it
 * 51. Both lengths are accepted because which one arrives depends on whether the
 * length header has been stripped; neither is *assumed*, and a length that is
 * neither is rejected rather than parsed at an offset that happens to look
 * plausible. The 42-byte layout this used to accept was not MS-CHAPv2 at all.
 *
 * The check itself, §8.1:
 *
 *     ChallengeHash = SHA-1(PeerChallenge ‖ AuthenticatorChallenge ‖ UserName)[0..8]
 *     NTResponse    = DES(K1, ChallengeHash) ‖ DES(K2, ChallengeHash) ‖ DES(K3, ChallengeHash)
 *
 * where the 16-octet `NtPasswordHash = MD4(UTF-16LE(password))` is split into three
 * 56-bit keys at bit offsets 0, 56 and 112 — *bit* offsets, because a DES key is
 * 56 significant bits packed seven to an octet with the eighth bit as parity. A
 * byte-aligned split (the older, widely-copied reading) produces a different key
 * and therefore a different response, which is why it is written out as a bit
 * stream rather than as three slices.
 *
 * The authenticator challenge is a parameter and is never invented here: the whole
 * point of it is that the client had to be told it out of band.
 */
export function verifyMsChapV2(
  stored: string,
  attribute: Buffer,
  authenticatorChallenge: Buffer,
  userName: string
): boolean {
  if (authenticatorChallenge.length !== 16) return false;

  const value = stripLengthHeader(attribute);
  if (!value) return false;

  const peerChallenge = value.subarray(2, 18);
  const reserved = value.subarray(18, 26);
  const ntResponse = value.subarray(26, 50);

  // RFC 2759 §4: "Reserved, must be zero." A non-zero value means the peer is
  // speaking something else, and continuing would mean guessing at its layout.
  for (const b of reserved) if (b !== 0) return false;

  const expected = msChapV2NtResponse(stored, peerChallenge, authenticatorChallenge, userName);
  return timingSafeEqual(expected, ntResponse);
}

/**
 * The RADIUS attribute carries a one-byte length header; a value that has already
 * had it stripped arrives as-is. Anything else is not a response we can parse.
 */
function stripLengthHeader(attribute: Buffer): Buffer | null {
  if (attribute.length === MS_CHAP2_RESPONSE_LEN) return attribute;
  if (attribute.length === MS_CHAP2_RESPONSE_LEN + 1) return attribute.subarray(1);
  return null;
}

/**
 * RFC 2759 §8.1, `GenerateNTResponse`.
 *
 * Exported because `tests/radius.test.mjs` checks it against the RFC's own
 * published trace (§9.2) rather than against itself — a verifier built from the
 * same code as the thing it verifies proves nothing about interoperability.
 */
export function msChapV2NtResponse(
  password: string,
  peerChallenge: Buffer,
  authenticatorChallenge: Buffer,
  userName: string
): Buffer {
  const challenge = msChapV2ChallengeHash(peerChallenge, authenticatorChallenge, userName);
  const ntHash = md4Utf16Le(password);

  // Three 56-bit keys from the 128-bit hash, taken as a bit stream. The hash is
  // zero-padded to 168 bits, so the third key is 16 real bits and 40 zeros —
  // which is what the RFC's trace has and what a MikroTik computes.
  const bits: number[] = [];
  for (const byte of ntHash) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  while (bits.length < 168) bits.push(0);

  const parts: Buffer[] = [];
  for (let block = 0; block < 3; block++) {
    const key = Buffer.alloc(8);
    for (let octet = 0; octet < 8; octet++) {
      let value = 0;
      for (let bit = 0; bit < 7; bit++) value = (value << 1) | bits[block * 56 + octet * 7 + bit];
      // Bit 8 of a DES key octet is parity and PC1 discards it, so its value
      // cannot affect the cipher; zero is correct and makes the key reproducible.
      key[octet] = value << 1;
    }
    parts.push(desEncrypt(challenge, key));
  }
  return Buffer.concat(parts);
}

/**
 * RFC 2759 §8.2, `ChallengeHash`: the first eight bytes of
 * SHA-1(PeerChallenge ‖ AuthenticatorChallenge ‖ UserName).
 *
 * The user name is used *without* any Windows NT domain prefix, per §8.2's note —
 * a MikroTik configured with a domain-qualified name computes a different hash
 * and is rejected, which looks like a wrong password.
 */
export function msChapV2ChallengeHash(
  peerChallenge: Buffer,
  authenticatorChallenge: Buffer,
  userName: string
): Buffer {
  return createHash("sha1")
    .update(Buffer.concat([
      peerChallenge,
      authenticatorChallenge,
      Buffer.from(stripDomain(userName), "ascii"),
    ]))
    .digest()
    .subarray(0, 8);
}

/** Everything before the last backslash, or the whole string if there is none. */
export function stripDomain(name: string): string {
  const i = name.lastIndexOf("\\");
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * RFC 2759 §8.7, `GenerateAuthenticatorResponse`: the 42-octet
 * "S=" + 40 uppercase hex digits the *server* must return in an Access-Accept.
 *
 * A MikroTik negotiates mutual authentication, so a server that accepts the
 * subscriber's proof and then says nothing back is a peer that dropped half the
 * protocol; depending on the router the session is torn down or the peer simply
 * never trusts the link. Two SHA-1 rounds over the magic constants below, which
 * RFC 2759 §8.7 defines by their ASCII text.
 */
export function msChapV2Success(
  password: string,
  ntResponse: Buffer,
  peerChallenge: Buffer,
  authenticatorChallenge: Buffer,
  userName: string
): string {
  const MAGIC1 = Buffer.from("Magic server to client signing constant", "ascii"); // 39
  const MAGIC2 = Buffer.from("Pad to make it do more than one iteration", "ascii"); // 41

  const ntHash = md4Utf16Le(password);
  const passwordHashHash = md4(ntHash);

  const first = createHash("sha1")
    .update(Buffer.concat([passwordHashHash, ntResponse, MAGIC1]))
    .digest();
  const challenge = msChapV2ChallengeHash(peerChallenge, authenticatorChallenge, userName);
  const second = createHash("sha1")
    .update(Buffer.concat([first, challenge, MAGIC2]))
    .digest();

  return "S=" + second.toString("hex").toUpperCase();
}

/**
 * The decoded parts of an MS-CHAPv2 response, for building the Success reply.
 *
 * Returns null when the layout is not RFC 2759, so a malformed response cannot
 * reach the point where a Success string is computed over nonsense.
 */
export function parseMsChapV2Response(attribute: Buffer): {
  ident: number;
  peerChallenge: Buffer;
  ntResponse: Buffer;
} | null {
  const value = stripLengthHeader(attribute);
  if (!value) return null;
  for (const b of value.subarray(18, 26)) if (b !== 0) return null;
  return {
    ident: value[0],
    peerChallenge: Buffer.from(value.subarray(2, 18)),
    ntResponse: Buffer.from(value.subarray(26, 50)),
  };
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
/* Simultaneous-Use                                                    */
/* ------------------------------------------------------------------ */

/** The message a subscriber sees when they are already connected elsewhere. */
export const REPLY_SESSION_LIMIT =
  "Session limit reached — another device is already connected";

/**
 * Reserves one of a subscriber's allowed concurrent sessions.
 *
 * The count and the reservation happen in one transaction, and the transaction
 * takes a per-username advisory lock first. That lock is the whole point: two
 * logins arriving together — which is exactly what a subscriber with two devices
 * does — otherwise both read "0 sessions" and both are accepted, and the limit
 * is a suggestion. With the lock, the second one waits, then sees the row the
 * first one inserted.
 *
 * A plain count-then-insert without the lock has the same problem, which is why
 * the claim is made here and not left to the NAS's first Accounting-Request: by
 * the time accounting arrives both logins have already been accepted, and
 * refusing one then means dropping a session the customer already has.
 *
 * The claim is reconciled in `accounting.ts`: when the real `Start` arrives with
 * a real session id, the placeholder for that username is removed in the same
 * transaction, so the session is counted once and not twice.
 */
export async function claimSession(
  username: string,
  nasIp: string
): Promise<{ allowed: boolean; reason: string }> {
  const s = await getSettings();
  const raw = s["radius.simultaneousUse"];
  const limit = Number(raw);

  // A blank or non-numeric setting must not read as 0 (unlimited) by accident:
  // that would silently disable the control for every subscriber. Anything that
  // is not a number falls back to the documented default of 1, and only a literal
  // "0" means unlimited.
  const max = Number.isInteger(limit) && limit >= 0 ? limit : 1;
  if (max === 0) return { allowed: true, reason: "unlimited sessions" };

  try {
    return await prisma.$transaction(async (tx) => {
      // hashtext() gives a stable 32-bit key from the username. A collision
      // serialises two unrelated subscribers for the duration of one
      // transaction, which costs microseconds; the alternative — no lock — lets a
      // genuine double-login through.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${username}))`;

      const live = await tx.radiusAccounting.count({
        where: { username, stoppedAt: null },
      });

      if (live >= max) {
        return {
          allowed: false,
          reason: `session limit reached — ${live} of ${max} concurrent session${max === 1 ? "" : "s"} already open`,
        };
      }

      // A placeholder row, because the real session id arrives with the first
      // Accounting-Request and there is nothing to key on until then. It counts as
      // live immediately, which is what makes the second of two simultaneous
      // logins see it.
      await tx.radiusAccounting.create({
        data: {
          username,
          // Unique, and clearly not a real session id so accounting's upsert on
          // `acctSessionId` can never collide with one.
          acctSessionId: `claim:${username}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          nasIp,
          status: "Start",
          // Expiry is backdated so the stale-session reaper removes an abandoned
          // claim on its next pass rather than leaving it counting forever for a
          // customer whose router never authenticated.
          startedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      return { allowed: true, reason: `session ${live + 1} of ${max} claimed` };
    });
  } catch (e) {
    // A failed claim must not be read as "allowed". Refusing is the safe
    // direction: the customer retries, and a login that never happened is a much
    // smaller problem than two sessions the limit was supposed to prevent.
    return {
      allowed: false,
      reason: `the session limit could not be checked (${e instanceof Error ? e.message : "unknown error"})`,
    };
  }
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
  /**
   * RFC 2759 §8.7 mutual authentication, for an MS-CHAPv2 login.
   *
   * Set only when the client proved mutual authentication, because the Success
   * string is computed over values taken from its own response — a client that
   * used PAP or CHAP has nothing to be authenticated back to.
   */
  msChapSuccess?: string;
};

/**
 * Decides whether a subscriber may be online.
 *
 * The settings read here are the same ones the billing lifecycle uses, so the
 * answer cannot disagree with the dashboard: `billing.gracePeriod` is the same
 * number the expiry sweep honours, and a customer suspended by that sweep is
 * rejected here by reading the same column it wrote.
 */
export async function decide(
  username: string,
  creds: Credentials,
  /** The NAS this request came from, for the session claim below. */
  nasIp: string = ""
): Promise<AuthDecision> {
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

  const ok = verifyCredential(customer.password, creds, username);
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

  // Simultaneous-Use. Last, and last *inside* the transaction, so the count that
  // is checked is the count the claim is made against. See `claimSession`.
  const claim = await claimSession(username, nasIp);
  if (!claim.allowed) {
    return {
      allowed: false,
      reason: claim.reason,
      username,
      credentialOk: true,
    };
  }

  // MS-CHAPv2 is mutually authenticated, so the reply carries an
  // AuthenticatorResponse. Computed from the *verified* response, which is why it
  // comes after the check above rather than being available to it.
  let msChapSuccess: string | undefined;
  if (creds.method === "MS-CHAPv2" && creds.challenge && creds.value) {
    const parsed = parseMsChapV2Response(creds.value);
    if (parsed) {
      msChapSuccess = msChapV2Success(
        customer.password,
        parsed.ntResponse,
        parsed.peerChallenge,
        creds.challenge,
        username
      );
    }
  }

  return {
    allowed: true,
    customerId: customer.id,
    username: customer.username,
    credentialOk: true,
    rateLimit: rateLimitFor(customer.package),
    sessionTimeoutSec: sessionTimeout(customer.expiryDate),
    msChapSuccess,
  };
}

/**
 * Checks one credential against the stored password.
 *
 * `userName` is needed only by MS-CHAPv2, because RFC 2759 §8.2 mixes the user
 * name into the challenge hash. It is the name *as the request carried it*, not
 * the stored one: a MikroTik configured with a different spelling computes a
 * different hash, and using the stored name here would accept a login that the
 * router itself will not complete.
 */
export function verifyCredential(
  stored: string,
  creds: Credentials,
  userName: string = ""
): boolean {
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
      // Absent challenge: the peer never sent MS-CHAP-Challenge, so there is
      // nothing to answer and nothing to verify against. Rejected rather than
      // substituted.
      if (!creds.challenge) return false;
      return verifyMsChapV2(stored, creds.value, creds.challenge, userName);
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

  // MS-CHAP2-Success first: a MikroTik negotiating mutual authentication checks
  // for it before it will bring the interface up, so an Accept without it leaves
  // the subscriber authenticating forever. Attached as a Buffer because attribute
  // 25 aliases MS-CHAP2-Response in the dictionary and the shared type is
  // `octets` — see radius/dictionaries/dictionary.mschap2.
  if (decision.msChapSuccess) {
    attributes.push([
      "Vendor-Specific",
      MICROSOFT_VENDOR,
      [["MS-CHAP2-Success", Buffer.from(decision.msChapSuccess, "ascii")]],
    ]);
  }

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
