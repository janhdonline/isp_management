/**
 * The RADIUS codec, as the web app sees it.
 *
 * `radius/packet.ts` loads the `radius` npm package and the vendor dictionaries
 * from the `radius/` process. The web app must not import from there: `radius/` is
 * a process entry point, and a server component importing one pulls `dgram` and
 * the codec into every bundle that transitively touches it.
 *
 * So the loading happens once, here, against the same dictionary files. The files
 * themselves are shared rather than duplicated — there is one definition of what
 * `Mikrotik-Rate-Limit` is, and it lives next to the server that speaks it.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);

/**
 * One decoded RADIUS packet.
 *
 * Attributes are vendor-defined, so there is no finite type to give them; this
 * alias says that once, here, rather than repeating `unknown` at every call site
 * and casting in six files. `RADIUS_ATTRS` narrows nothing on purpose — callers
 * read a named attribute and must handle it being absent.
 */
/**
 * Vendor attributes have no finite type, so this is the one documented place that
 * says so. Callers still read a named attribute and must handle it being absent —
 * the alias widens the value, it does not promise the key exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RadiusAttrs = Record<string, any>;

/** One encoded attribute: a name, or a vendor name wrapping a list of pairs. */
export type RadiusAttr = [string, string | number | Buffer] | [string, string, RadiusAttr[]];

export interface RadiusDecoded {
  code: string;
  identifier: number;
  attributes: RadiusAttrs;
  raw?: Buffer;
  authenticator?: Buffer;
}

export interface RadiusDict {
  /**
   * Loads one dictionary file. Preferred over `load_dictionaries`, which walks a
   * package-relative default directory that a bundler may have rewritten.
   */
  load_dictionary(file: string): void;
  /**
   * The library's lazy loader, called by every encode and decode. It is on the
   * interface because it is replaced with a no-op — see `loadDictionaries`.
   */
  load_dictionaries(): void;
  decode(args: { packet: Buffer; secret?: string; no_secret?: boolean }): RadiusDecoded | null;
  decode_without_secret(args: { packet: Buffer }): RadiusDecoded | null;
  encode(args: {
    code: string;
    identifier?: number;
    secret: string;
    attributes?: RadiusAttr[];
    authenticator?: Buffer;
  }): Buffer;
  encode_response(args: {
    packet: RadiusDecoded;
    code: string;
    secret: string;
    attributes?: RadiusAttr[];
  }): Buffer;
  verify_response(args: { request: Buffer; response: Buffer; secret: string }): boolean;
  encrypt_field(field: string): Buffer;
}

export const radiusCodec: RadiusDict = require_("radius");

let loaded = false;

/**
 * This project's own dictionary directory — the MikroTik and MS-CHAPv2 files.
 *
 * `RADIUS_DICTIONARIES` overrides it, which is how a deployment that does not
 * ship the repository layout (a systemd unit with a read-only filesystem, say)
 * points the process at a copy. Returns null rather than a path that does not
 * exist: a missing directory must not throw here, or one misconfiguration takes
 * the whole web app down instead of failing one feature.
 */
export function dictionaries(): string | null {
  // No filesystem probe: `existsSync` on a computed path makes the bundler trace
  // the entire project, which ships every source file to production for the sake
  // of one boolean. A missing directory is caught per file in `loadDictionary`
  // instead, and the only thing lost by a wrong path is the vendor attributes —
  // which show up as a missing rate limit on the reply, not as a crash.
  return process.env.RADIUS_DICTIONARIES ?? join(process.cwd(), "radius", "dictionaries");
}

/** Loads one dictionary file, named rather than handed a directory. */
function loadDictionary(file: string) {
  try {
    radiusCodec.load_dictionary(file);
  } catch {
    // A malformed or unreadable dictionary is swallowed rather than thrown. The
    // RFC ones still load, so PAP and the standard attributes work; what is lost
    // is Mikrotik-Rate-Limit, which shows up as a subscriber on the router's
    // default profile rather than as a crash that takes authentication with it.
  }
}



export function loadDictionaries() {
  if (loaded) return;

  // Loaded by *file*, never with `load_dictionaries()`, and from a named list
  // rather than a directory listing.
  //
  // Three reasons, each learned the hard way:
  //
  // 1. `load_dictionaries()` walks a fixed path derived from the package's
  //    `__dirname`. Inside a Next.js server bundle that resolves to `/ROOT`,
  //    which does not exist, and the call throws `Invalid dictionary location` —
  //    which is how the test-auth endpoint came to return 500.
  // 2. Every `encode`/`decode` calls `load_dictionaries()` itself, and the
  //    library's lazy loader has no idea what we declared. RFC 2869 puts
  //    `Event-Timestamp` on attribute 55, and so does RFC 2868's `Output-Octets`.
  //    Whichever loads last wins, and re-running the loader resets 55 back to
  //    `date` — so an encoded `Output-Octets` of 500 fails with
  //    `in_value.getTime is not a function`, having been read as a Date.
  // 3. A directory listing is not statically analysable, so the bundler cannot
  //    tell that these files are needed and leaves them out of a standalone
  //    build. Naming them makes the dependency visible, which is the difference
  //    between working in development and working deployed.
  for (const dir of [packageDictionaries(), dictionaries()]) {
    if (!dir) continue;
    for (const file of dictionaryFiles()) {
      loadDictionary(join(dir, file));
    }
  }

  // The dictionaries are loaded; the library must not reload its own defaults.
  // Replaced rather than worked around, because every code path into the codec
  // calls it and there is no flag to set.
  radiusCodec.load_dictionaries = () => {
    // Already loaded, by name, in loadDictionaries().
  };

  loaded = true;
}

/**
 * The dictionary files in a directory, or none if it cannot be read.
 *
 * `readdir` still runs — a deployment may add a vendor dictionary — but the
 * known names are listed first so the bundler sees them, and the listing is only
 * a way to pick up a file added after the build.
 */
function dictionaryFiles(): string[] {
  // No directory listing. Reading one would pick up a dictionary added after the
  // build, at the cost of a dynamic filesystem access that makes the bundler trace
  // the whole project — every source file shipped to production to prove one
  // directory was not needed. A deployment that needs an extra dictionary sets
  // `RADIUS_DICTIONARIES` at a path holding only what it needs.
  const files: string[] = [...REQUIRED_DICTIONARIES];
  const extra = process.env.RADIUS_DICTIONARY_FILES;
  if (extra) files.push(...extra.split(",").map((f) => f.trim()).filter(Boolean));
  return files;
}

/**
 * The RFC dictionaries this server needs, and this project's own.
 *
 * Note on `next build`: it warns that this read causes the whole project to be
 * traced into the server output. The read is by name, from one of ten literals or
 * an env var, and it is a CommonJS library doing it, so the bundler cannot prove
 * otherwise. It is harmless here because this project runs `next start` against
 * the repository (see the systemd unit in the README), where the dictionaries are
 * already on disk; it would matter to a `output: "standalone"` deployment, which
 * this app does not use.
 *
 * Listed rather than discovered so a bundler can trace them. `rfc2868` is the
 * package's tunnel dictionary; `rfc2869` is where the attribute-55 collision
 * comes from, and it is listed because the names we depend on (`Acct-*`) live
 * beside the one that collides. Ours are loaded last so their names win.
 */
const REQUIRED_DICTIONARIES = [
  // RFC 2865 — the authentication attributes: User-Name, User-Password, CHAP,
  // NAS-IP-Address, Framed-IP-Address, Service-Type, Session-Timeout.
  "dictionary.rfc2865",
  // RFC 2866 — the accounting attributes.
  "dictionary.rfc2866",
  // RFC 3162 — Framed-IPv6-Prefix, for a v6 allocation.
  "dictionary.rfc3162",
  // RFC 3576 — Event-Timestamp.
  "dictionary.rfc3576",
  // RFC 5176 — the CoA packet types this server sends and receives.
  "dictionary.rfc5176",
  // RFC 2868 — the package's tunnel attributes. Also where Output-Octets lives.
  "dictionary.rfc2868",
  // RFC 2869 — the extended accounting attributes, and Event-Timestamp on 55.
  "dictionary.rfc2869",
  // Ours, last: the vendor attributes and the two octet counters that RFC 2869
  // would otherwise rename.
  "dictionary.mikrotik",
  "dictionary.mschap2",
  "dictionary.rfc2868",
] as const;

/**
 * Where the `radius` package's own RFC dictionaries live.
 *
 * Resolved rather than assumed: the package's `__dirname`-relative default is
 * rewritten by a bundler, and a directory that is really the package root —
 * containing package.json and no dictionaries — makes every load throw and leave
 * the codec with an empty attribute table that rejects every packet as an unknown
 * attribute.
 */
function packageDictionaries(): string | null {
  // Resolved, not assumed — this is the only path that is correct regardless of
  // where the module was loaded from. No existence check: see `dictionaries`.
  try {
    return packageDictionaryDirFromResolve();
  } catch {
    return join(process.cwd(), "node_modules", "radius", "dictionaries");
  }
}

/**
 * The package's dictionary directory, from module resolution.
 *
 * `require.resolve("radius")` is `node_modules/radius/lib/radius.js`, so the
 * dictionaries are two levels up *and* in a `dictionaries` subdirectory.
 * Returning the package root instead — which is what a single dirname gives —
 * points at package.json and friends, and then no dictionary resolves: every load
 * throws, is swallowed, and the codec ends up with an empty attribute table that
 * rejects every packet as an unknown attribute.
 */
function packageDictionaryDirFromResolve(): string {
  return join(dirname(dirname(require_.resolve("radius"))), "dictionaries");
}