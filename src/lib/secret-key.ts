import { randomBytes } from "node:crypto";

/**
 * The HMAC key for session cookies, TOTP challenge tokens and anything else that
 * has to be unforgeable across requests.
 *
 * ## Why this file exists
 *
 * `auth.ts` opens with `import "server-only"`, which is correct — the session
 * cookie helpers belong on the server. It also makes the whole file **untestable**:
 * `server-only` resolves to a module that throws outside a `react-server` bundle,
 * so a plain `node --test` cannot import it. Two other services in this codebase
 * (`wallet.ts`, `corporate.ts`) carry a comment saying exactly this, and work
 * around it by keeping their rules elsewhere.
 *
 * The key is the one piece of `auth.ts` that is pure — it reads an environment
 * variable and returns bytes — so it lives here, and `auth.ts` re-exports it.
 * That keeps the guard where it belongs and makes the part worth testing reachable.
 */

let cachedKey: Uint8Array | null = null;

export function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    const message =
      "AUTH_SECRET is not set. Generate one with:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"\n' +
      "and put it in .env — anyone who knows this value can forge a session cookie.";

    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    }
    console.warn(`[auth] ${message}\n[auth] Using a random per-process key; sessions end on restart.`);
    cachedKey = new TextEncoder().encode(randomBytes(32).toString("base64url"));
    return cachedKey;
  }

  if (configured.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters long.");
  }

  cachedKey = new TextEncoder().encode(configured);
  return cachedKey;
}
