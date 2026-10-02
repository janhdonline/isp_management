/**
 * IPv4 subnet arithmetic (ISP.md §34).
 *
 * Small and written out rather than pulled from a library, because the rules here
 * are the ones a PPPoE pool actually needs and they have three exceptions that a
 * general-purpose library hides behind a flag:
 *
 *   - the network and broadcast addresses are not handed out;
 *   - a /31 or /32 has *no* network or broadcast (RFC 3021), so all its addresses
 *     are usable — a /31 point-to-point link with a "subnet zero" convention that
 *     excludes nothing is the RFC 3021 rule, not a bug;
 *   - a pool may reserve a gateway on top of that, which is why a /24 yields 253
 *     addresses rather than 254.
 *
 * IPv4 only, and deliberately: a PPPoE pool on a Bangladeshi ISP is v4, and
 * silently accepting a v6 CIDR and then computing nonsense would be worse than
 * refusing it with a message.
 */

export type ParsedCidr = {
  network: number;
  broadcast: number;
  prefix: number;
  size: number;
  /** Every address in the subnet, network and broadcast included. */
  all: string[];
  /** Addresses eligible for allocation: no network, no broadcast. */
  usable: string[];
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parses a dotted-quad into a 32-bit integer, or null if it is not one. */
export function parseIpv4(ip: string): number | null {
  const m = IPV4.exec(ip.trim());
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i]);
    // `00` and `010` are not addresses. Being strict here is what keeps a
    // mistyped value from silently becoming a different address.
    if (!Number.isInteger(part) || part < 0 || part > 255) return null;
    if (m[i].length > 1 && m[i][0] === "0") return null;
    value = value * 256 + part;
  }
  return value >>> 0;
}

export function formatIpv4(value: number): string {
  const v = value >>> 0;
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

/** The canonical form: the network address with the prefix, e.g. "10.0.5.3/24" → "10.0.5.0/24". */
export function parseCidr(cidr: string): ParsedCidr | null {
  const text = cidr.trim();
  const slash = text.lastIndexOf("/");
  if (slash < 0) return null;

  const base = parseIpv4(text.slice(0, slash));
  const prefix = Number(text.slice(slash + 1));
  if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const size = 2 ** (32 - prefix);
  // Masking to the prefix gives the network address, so a pool written with a
  // host bit set still describes the right subnet rather than a different one.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network + size - 1) >>> 0;

  const all: string[] = [];
  for (let i = 0; i < size; i++) all.push(formatIpv4((network + i) >>> 0));

  // RFC 3021: a /31 is a point-to-point link with both addresses usable, and a
  // /32 is a single host. Neither has a network or broadcast to skip.
  const usable =
    prefix >= 31 ? [...all] : all.slice(1, -1);

  return { network, broadcast, prefix, size, all, usable };
}

/** True when `ip` falls inside the parsed subnet. */
export function contains(p: ParsedCidr, ip: string): boolean {
  const v = parseIpv4(ip);
  if (v === null) return false;
  return v >= p.network && v <= p.broadcast;
}

/**
 * The addresses a pool can actually hand out: usable, minus the gateway.
 *
 * The gateway is excluded because a router cannot route a pool whose gateway is
 * inside it — the address is infrastructure, and handing it to a subscriber is how
 * a whole pool falls over.
 */
export function allocatableAddresses(p: ParsedCidr, gateway?: string | null): string[] {
  const gw = gateway ? parseIpv4(gateway) : null;
  if (gw === null) return [...p.usable];
  return p.usable.filter((ip) => parseIpv4(ip) !== gw);
}

/**
 * The same address with each octet zero-padded, so a lexical sort is a numeric
 * one.
 *
 * "10.30.0.10" sorts before "10.30.0.2" as text, which is right as text and
 * wrong as a subnet: auto-assign would hand out .10 through .19 before ever
 * reaching .2, and an operator looking at the pool would wonder why. Storing this
 * alongside the readable `ip` keeps both — the human value on screen, the
 * ordering the database can do.
 */
export function sortKeyFor(ip: string): string {
  const v = parseIpv4(ip);
  if (v === null) return `zzz.${ip}`;
  return [24, 16, 8, 0].map((shift) => lpad(((v >>> shift) & 255).toString(), 3, "0")).join(".");
}

function lpad(value: string, width: number, pad: string): string {
  return value.padStart(width, pad);
}

/** How many addresses a pool contributes, given its gateway. */
export function poolCapacity(p: ParsedCidr, gateway?: string | null): number {
  return allocatableAddresses(p, gateway).length;
}