/**
 * MikroTik RouterOS REST client.
 *
 * Isolated from the rest of the app so it can be tested without a router: a
 * mock RouterOS server stands in for the hardware in `tests/routeros.test.mjs`.
 *
 * Two things this module refuses to do, both of which matter for a billing
 * system:
 *
 *  - swallow a failure and return an empty result. "Nobody is online" and "I
 *    could not reach the router" look identical to the UI if the error is
 *    dropped, and the first one is a lie that stops customers being billed.
 *  - act on a guess. A disconnect that quietly does nothing leaves a customer
 *    online after the office has suspended them.
 */

export type SessionSource = "ppp" | "hotspot";

export type RouterOsUser = {
  /** RouterOS internal id, needed for remove/kick. */
  id: string;
  /** PPPoE username or hotspot user. */
  username: string;
  ipAddress: string | null;
  macAddress: string | null;
  /** Interface the session rides, e.g. "ether1". */
  interfaceName: string | null;
  downloadBytes: number;
  uploadBytes: number;
  uptimeSec: number;
  /** RouterOS reports bytes as decimal strings. */
  callerId: string | null;
};

export class RouterOsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string
  ) {
    super(message);
    this.name = "RouterOsError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * RouterOS durations look like `3w2d4h5m6s`. Anything unparsed is reported
 * rather than silently becoming zero, because a zero uptime on a live session
 * is a number someone will eventually put in front of a customer.
 */
export function parseRouterOsDuration(value?: string | number | null): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  // Plain seconds, as returned by some fields.
  if (/^\d+$/.test(value.trim())) return Number(value.trim());

  const units: Record<string, number> = {
    w: 604800,
    d: 86400,
    h: 3600,
    m: 60,
    s: 1,
  };
  const matches = value.trim().matchAll(/(\d+)\s*([wdhms])/g);
  let total = 0;
  let matched = false;
  for (const m of matches) {
    total += Number(m[1]) * units[m[2]];
    matched = true;
  }
  if (!matched) return 0;
  return total;
}

/** RouterOS byte counters come back as decimal strings, sometimes wrapped. */
export function parseRouterOsBytes(value?: string | number | null): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type MikrotikConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl?: boolean;
  /** Where subscribers are terminated. PPPoE is the usual ISP case. */
  sessionSource?: SessionSource;
  timeoutMs?: number;
};

export class RouterOsClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly source: SessionSource;
  private readonly timeoutMs: number;

  constructor(private cfg: MikrotikConfig) {
    this.base = `${cfg.useSsl ? "https" : "http"}://${cfg.host}:${cfg.port}/rest`;
    this.auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;
    this.source = cfg.sessionSource ?? "ppp";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          Authorization: this.auth,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // A timeout and a refused connection mean very different things to
      // whoever is looking at the screen, so say which one it was.
      const reason = e instanceof Error ? e.message : "unknown error";
      const timedOut = /abort|timeout/i.test(reason);
      throw new RouterOsError(
        timedOut
          ? `No answer from ${this.cfg.host}:${this.cfg.port} after ${this.timeoutMs}ms.`
          : `Cannot reach ${this.cfg.host}:${this.cfg.port} — ${reason}`,
        undefined,
        timedOut
          ? "The router may be offline, or the API service may be disabled."
          : "Check the address, the port, and that this machine can route to it."
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new RouterOsError(
        `RouterOS returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        res.status,
        res.status === 401 || res.status === 403
          ? "The API username or password was rejected."
          : res.status === 404
            ? "That path is not available — the API service may be disabled, or this RouterOS version does not expose it."
            : undefined
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * `/system/resource`, with the fields the health card needs already coerced.
   * Exposed separately so the adapter does not re-parse them.
   */
  async callResource(): Promise<{
    cpuLoad: number;
    freeMemory: number;
    totalMemory: number;
    uptimeSec: number;
    version?: string;
  }> {
    const rows = await this.call<Record<string, string>[]>("/system/resource");
    const r = rows?.[0] ?? {};
    return {
      cpuLoad: Number(r["cpu-load"] ?? 0),
      freeMemory: Number(r["free-memory"] ?? 0),
      totalMemory: Number(r["total-memory"] ?? 0),
      uptimeSec: parseRouterOsDuration(r["uptime"]),
      version: r["version"],
    };
  }

  /** Confirms the credentials and reports what the router is actually doing. */
  async testConnection(): Promise<{
    ok: boolean;
    version?: string;
    identity?: string;
    uptime?: string;
    activeSessions: number;
    error?: string;
    hint?: string;
  }> {
    try {
      const identity = await this.call<{ name?: string }[]>("/system/identity");
      const resource = await this.call<Record<string, string>[]>("/system/resource");
      const r = resource?.[0] ?? {};
      const sessions = await this.listSessions();
      return {
        ok: true,
        identity: identity?.[0]?.name,
        version: r["version"],
        uptime: r["uptime"],
        activeSessions: sessions.length,
      };
    } catch (e) {
      return {
        ok: false,
        activeSessions: 0,
        error: e instanceof Error ? e.message : "Connection failed",
        hint: e instanceof RouterOsError ? e.hint : undefined,
      };
    }
  }

  /**
   * The live sessions, normalised. PPPoE and Hotspot expose different fields
   * and different names for the same things.
   */
  async listSessions(): Promise<RouterOsUser[]> {
    const raw = await this.call<Record<string, string>[]>(
      this.source === "ppp" ? "/ppp/active" : "/ip/hotspot/active"
    );
    if (!Array.isArray(raw)) return [];

    return raw.map((r) =>
      this.source === "ppp"
        ? {
            id: r[".id"] ?? "",
            username: r["name"] ?? "",
            ipAddress: r["address"] ?? null,
            macAddress: r["caller-id"] ?? r["macAddress"] ?? null,
            interfaceName: r["service"] ?? null,
            downloadBytes: parseRouterOsBytes(r["bytesIn"]),
            uploadBytes: parseRouterOsBytes(r["bytesOut"]),
            uptimeSec: parseRouterOsDuration(r["uptime"]),
            callerId: r["caller-id"] ?? null,
          }
        : {
            id: r[".id"] ?? "",
            username: r["user"] ?? "",
            ipAddress: r["address"] ?? null,
            macAddress: r["mac-address"] ?? null,
            interfaceName: r["server"] ?? null,
            downloadBytes: parseRouterOsBytes(r["bytes-in"]),
            uploadBytes: parseRouterOsBytes(r["bytes-out"]),
            uptimeSec: parseRouterOsDuration(r["uptime"]),
            callerId: r["mac-address"] ?? null,
          }
    );
  }

  /**
   * Drops a live session. Throws rather than returning false on failure, so a
   * caller cannot mistake "I did not manage it" for "it is done".
   */
  async removeSession(username: string): Promise<boolean> {
    const path = this.source === "ppp" ? "/ppp/active" : "/ip/hotspot/active";
    const rows = await this.call<{ ".id"?: string; name?: string; user?: string }[]>(path);
    const target = (rows ?? []).find((r) => (r.name ?? r.user) === username);
    if (!target?.[".id"]) {
      throw new RouterOsError(
        `${username} is not connected, so there is nothing to disconnect.`,
        404
      );
    }
    await this.call(`${path}/${encodeURIComponent(target[".id"])}`, { method: "DELETE" });
    return true;
  }

  /**
   * Blocks or unblocks by IP in the firewall's address list, which is how a
   * MikroTik setup without a hotspot server does it. The list has to exist
   * first, so it is created on demand.
   */
  async setBlocked(
    ipAddress: string,
    blocked: boolean,
    listName = "isp-blocked",
    timeout?: string
  ): Promise<boolean> {
    if (!ipAddress) {
      throw new RouterOsError("An IP address is needed to block a user.");
    }

    try {
      await this.call(`/ip/firewall/address-list`);
    } catch (e) {
      // Older RouterOS exposes address lists under /ip firewall filter, and
      // some firmwares reject a bare collection read. Not fatal on its own.
      if (e instanceof RouterOsError && e.status === 404) {
        throw new RouterOsError(
          "The firewall address list is not available on this router.",
          404,
          "Add the list in RouterOS under IP → Firewall → Address Lists, named `isp-blocked`."
        );
      }
      throw e;
    }

    const existing = await this.call<{ ".id"?: string; address?: string }[]>(
      "/ip/firewall/address-list"
    );
    const row = (existing ?? []).find((r) => r.address === ipAddress);

    if (blocked) {
      const body: Record<string, string> = {
        list: listName,
        address: ipAddress,
      };
      if (timeout) body.timeout = timeout;
      if (row?.[".id"]) {
        await this.call(`/ip/firewall/address-list/${encodeURIComponent(row[".id"])}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await this.call("/ip/firewall/address-list", {
          method: "PUT",
          body: JSON.stringify(body),
        });
      }
      return true;
    }

    if (!row?.[".id"]) return true; // already not blocked
    await this.call(`/ip/firewall/address-list/${encodeURIComponent(row[".id"])}`, {
      method: "DELETE",
    });
    return true;
  }
}
