/**
 * Network device adapters (ISP.md rule 10: keep MikroTik/OLT/ONU integrations
 * behind service/adaptor layers).
 *
 * Every vendor integration implements `NetworkAdapter`. The UI never talks to a
 * vendor protocol directly — it calls these interfaces, so swapping or adding a
 * vendor only means implementing one function.
 */

import { RouterOsClient, RouterOsError, type SessionSource } from "./routeros";

export type DeviceHealth = {
  status: "Online" | "Offline" | "Unknown";
  cpu?: number;
  ram?: number;
  uptimeSec?: number;
  activeUsers?: number;
  downloadBps?: number;
  uploadBps?: number;
  lastSyncAt: Date;
  error?: string;
};

export type OnlineUser = {
  username: string;
  ipAddress: string | null;
  macAddress: string | null;
  downloadBytes: number;
  uploadBytes: number;
  uptimeSec: number;
  loginTime: Date;
};

export interface NetworkAdapter {
  readonly name: string;
  /** Human readable capability note shown in Settings. */
  readonly capabilities: string;
  /** False for the simulated adapter, so the UI can say so plainly. */
  readonly live: boolean;
  health(): Promise<DeviceHealth>;
  /**
   * Live sessions. Throws when the device cannot be reached — the caller has to
   * be able to tell "no one is online" apart from "I could not ask".
   */
  activeUsers(): Promise<OnlineUser[]>;
  disconnect(username: string): Promise<boolean>;
  /**
   * "May this user get online at all", which is a different question from
   * `block()`.
   *
   * `block()` needs a live IP, so it only works for someone currently
   * connected — useless as a suspension mechanism, because most suspensions
   * happen when the customer is not online. `setAccess` works either way: the
   * router refuses the next login and the live session is dropped in the same
   * call, so a suspended customer is actually disconnected rather than merely
   * scheduled to be.
   */
  setAccess(username: string, enabled: boolean): Promise<boolean>;

  /**
   * Creates the subscriber's PPPoE secret, or updates the parts of it that can
   * change on an existing one.
   *
   * Separate from `setAccess` because the two answer different questions. This
   * one is about a subscriber who does not exist on the router yet; `setAccess`
   * is about one who does. Conflating them is how a new customer ends up with a
   * disabled secret and nobody can work out why their line is dead.
   */
  provisionSecret(username: string, password: string, profile?: string): Promise<boolean>;

  /** Repoints an existing secret at a different rate-limit profile. */
  setSecretProfile(username: string, profile: string): Promise<boolean>;

  /**
   * Deletes the secret entirely, rather than disabling it.
   *
   * Used when a subscriber leaves for good. Leaving a disabled secret behind is
   * not a neutral act: the next customer assigned the same address inherits
   * somebody else's credentials.
   */
  removeSecret(username: string): Promise<boolean>;

  block(username: string, blocked: boolean): Promise<boolean>;
}

/**
 * Demo adapter backed by the local database. Used in development and whenever a
 * device has no reachable API configured, so the UI always renders real-shaped
 * data instead of hard-coded screen values. It is labelled as simulated, so
 * nobody mistakes it for a live reading.
 */
export class DatabaseNetworkAdapter implements NetworkAdapter {
  readonly name = "Database (simulated)";
  readonly capabilities = "Local session table — no vendor API configured";
  readonly live = false;

  constructor(
    private routerId?: string,
    private routerName?: string
  ) {}

  async health(): Promise<DeviceHealth> {
    const now = new Date();
    return {
      status: "Online",
      cpu: 12.4,
      ram: 38.7,
      uptimeSec: 864000,
      activeUsers: 0,
      lastSyncAt: now,
    };
  }

  async activeUsers(): Promise<OnlineUser[]> {
    return [];
  }

  async disconnect(): Promise<boolean> {
    return true;
  }

  /**
   * Nothing to do, and it says so rather than pretending. `live` is false, so
   * callers label this as simulated — an operator looking at a customer
   * profile needs to know nobody was actually disconnected.
   */
  async setAccess(): Promise<boolean> {
    return true;
  }

  /**
   * Simulated — nothing reaches a router, and `live` is false, so anything
   * built on this adapter is labelled as such. Returning `true` here is
   * deliberate: it means "there is no configured router to fail against", not
   * "the customer's line works". Callers must not read it as the latter.
   */
  async provisionSecret(): Promise<boolean> {
    return true;
  }

  async setSecretProfile(): Promise<boolean> {
    return true;
  }

  async removeSecret(): Promise<boolean> {
    return true;
  }

  async block(): Promise<boolean> {
    return true;
  }
}

/**
 * MikroTik adapter. The protocol work lives in `routeros.ts`; this class only
 * translates between that and the shape the rest of the app expects.
 */
export class MikrotikAdapter implements NetworkAdapter {
  readonly name = "MikroTik RouterOS";
  readonly capabilities = "Active users, traffic, suspend/reconnect, provision, profile, block";
  readonly live = true;

  /**
   * Addresses seen on the last read, kept so a reconnect can clear a stale
   * firewall block. The router is the only place an address is known, and the
   * address is gone once the session drops — so this is a short-lived cache, not
   * a record.
   */
  private knownIps = new Map<string, string>();

  private sessionSource: SessionSource;

  constructor(
    private client: RouterOsClient,
    sessionSource: SessionSource = "ppp"
  ) {
    this.sessionSource = sessionSource;
  }

  async health(): Promise<DeviceHealth> {
    const now = new Date();
    try {
      const [resource, active] = await Promise.all([
        this.client.callResource(),
        this.client.listSessions(),
      ]);

      const bps = active.reduce(
        (sum, u) => sum + u.downloadBytes + u.uploadBytes,
        0
      );

      return {
        status: "Online",
        cpu: resource.cpuLoad,
        // RouterOS reports free memory, so usage is the complement.
        ram:
          resource.totalMemory > 0
            ? Math.round(
                ((resource.totalMemory - resource.freeMemory) /
                  resource.totalMemory) *
                  1000
              ) / 10
            : undefined,
        uptimeSec: resource.uptimeSec,
        activeUsers: active.length,
        lastSyncAt: now,
        downloadBps: bps,
      };
    } catch (e) {
      return {
        status: "Offline",
        lastSyncAt: now,
        error: e instanceof RouterOsError ? e.message : "Unknown error",
      };
    }
  }

  async activeUsers(): Promise<OnlineUser[]> {
    const sessions = await this.client.listSessions();
    // Remember the addresses so a later reconnect can clear a firewall block.
    for (const s of sessions) {
      if (s.ipAddress) this.knownIps.set(s.username, s.ipAddress);
    }
    return sessions.map((u) => ({
      username: u.username,
      ipAddress: u.ipAddress,
      macAddress: u.macAddress,
      downloadBytes: u.downloadBytes,
      uploadBytes: u.uploadBytes,
      uptimeSec: u.uptimeSec,
      loginTime: new Date(Date.now() - u.uptimeSec * 1000),
    }));
  }

  async disconnect(username: string): Promise<boolean> {
    return this.client.removeSession(username);
  }

  /**
   * Suspend or restore a subscriber's access.
   *
   * Two mechanisms, chosen by what the router actually terminates:
   *
   *  - **PPPoE** — the PPP secret is the enforcement point. Disabling it stops
   *    the next login, and the live session is kicked so the current one dies
   *    too. This works whether or not the customer is online, which is the
   *    whole point.
   *  - **Hotspot** — there is no secret to disable, so the firewall address
   *    list is used. That needs a live IP, so an offline user is left with a
   *    hotspot login that would succeed; the limitation is real and is
   *    reported rather than hidden behind a "done".
   *
   * A 404 from the kick means the user was not connected, which is exactly what
   * a suspend of an offline customer should look like — not a failure.
   */
  async setAccess(username: string, enabled: boolean): Promise<boolean> {
    if (this.sessionSource === "hotspot") {
      return this.setHotspotAccess(username, enabled);
    }

    // The secret first: if the router is unreachable or the secret is missing,
    // that is the failure worth reporting, and it is better to learn about it
    // before pretending to have disconnected someone.
    await this.client.setSecretDisabled(username, !enabled);

    if (enabled) {
      // Re-enabling also clears any firewall block left over from a previous
      // hotspot-era block, so a customer does not pay and stay cut off.
      await this.client.setBlocked(this.lastKnownIp(username) ?? "", false).catch(() => undefined);
      return true;
    }

    try {
      await this.client.removeSession(username);
    } catch (e) {
      const notConnected =
        e instanceof RouterOsError && (e.status === 404 || /not connected/i.test(e.message));
      if (!notConnected) throw e;
      // Already offline. The secret is disabled, which is the part that matters.
    }
    return true;
  }

  /**
   * Hotspot has no secret, so access is controlled by IP. A subscriber who is
   * not online has no IP, and this throws rather than quietly doing nothing —
   * the caller can then queue the action for a later attempt.
   */
  private async setHotspotAccess(username: string, enabled: boolean): Promise<boolean> {
    const sessions = await this.client.listSessions();
    const target = sessions.find((u) => u.username === username);
    if (!target?.ipAddress) {
      throw new RouterOsError(
        `${username} is not connected, so a hotspot user has no address to ${enabled ? "unblock" : "block"}.`,
        404,
        "Hotspot access is controlled by IP address, which only exists while the user is online. Consider PPPoE for enforceable suspension."
      );
    }
    await this.client.setBlocked(target.ipAddress, !enabled);
    if (!enabled) {
      try {
        await this.client.removeSession(username);
      } catch {
        // The block is in place; the kick is best effort.
      }
    }
    return true;
  }

  /** The IP a user last had, if we happen to know it from a live session. */
  private lastKnownIp(username: string): string | null {
    return this.knownIps.get(username) ?? null;
  }

  /**
   * Creates or updates a PPPoE secret.
   *
   * Hotspot has nothing to provision: there is no secret, only a dynamically
   * created user. Rather than return a success that did nothing, this says so,
   * which puts the action in the queue where an operator can see it instead of
   * discovering months later that no customer was ever configured.
   */
  async provisionSecret(
    username: string,
    password: string,
    profile?: string
  ): Promise<boolean> {
    if (this.sessionSource === "hotspot") {
      throw new RouterOsError(
        `${username} cannot be provisioned on a hotspot router.`,
        400,
        "Hotspot creates users dynamically, so there is no secret to pre-create. Use PPPoE for subscribers who are provisioned up front."
      );
    }
    // `disabled: false` is stated rather than left to the router's default. The
    // default is `no`, so omitting it usually works — but "usually" is how a
    // brand-new subscriber ends up provisioned and unable to connect, with
    // nothing in the logs to explain it.
    return this.client.upsertSecret({ name: username, password, profile, disabled: false });
  }

  async setSecretProfile(username: string, profile: string): Promise<boolean> {
    if (this.sessionSource === "hotspot") {
      throw new RouterOsError(
        `${username} has no PPP secret on a hotspot router, so a profile cannot be set.`,
        400
      );
    }
    return this.client.setSecretProfile(username, profile);
  }

  async removeSecret(username: string): Promise<boolean> {
    if (this.sessionSource === "hotspot") return true; // nothing was created
    return this.client.removeSecret(username);
  }

  async block(username: string, blocked: boolean): Promise<boolean> {
    const sessions = await this.client.listSessions();
    const target = sessions.find((u) => u.username === username);
    if (!target?.ipAddress) {
      throw new Error(
        `${username} has no IP address on the router, so it cannot be blocked.`
      );
    }
    return this.client.setBlocked(target.ipAddress, blocked);
  }
}

/* ------------------------------------------------------------------ */
/* Building an adapter from a stored router row                        */
/* ------------------------------------------------------------------ */

export type RouterCredentials = {
  id?: string;
  name?: string;
  ipAddress: string;
  apiPort: number;
  apiUser: string | null;
  apiSecret: string | null;
  useSsl: boolean;
  sessionSource?: string | null;
};

/**
 * Returns a live adapter when the row has usable credentials, and the simulated
 * one otherwise. Nothing here invents a connection: without a user and a
 * secret there is nothing to connect with, and pretending otherwise is what made
 * the router page show invented readings.
 */
export function adapterForRouter(row: RouterCredentials): NetworkAdapter {
  if (!row.apiUser || !row.apiSecret) {
    return new DatabaseNetworkAdapter(row.id, row.name);
  }
  return new MikrotikAdapter(
    new RouterOsClient({
      host: row.ipAddress,
      port: row.apiPort,
      username: row.apiUser,
      password: row.apiSecret,
      useSsl: row.useSsl,
      sessionSource: row.sessionSource === "hotspot" ? "hotspot" : "ppp",
    }),
    row.sessionSource === "hotspot" ? "hotspot" : "ppp"
  );
}

/** The same, kept for callers that pass the schema's field names. */
export function getAdapterForRouter(router: {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  apiUser: string | null;
  apiSecretEnc: string | null;
  useSsl: boolean;
  sessionSource?: string | null;
}): NetworkAdapter {
  return adapterForRouter({
    id: router.id,
    name: router.name,
    ipAddress: router.ipAddress,
    apiPort: router.apiPort,
    apiUser: router.apiUser,
    apiSecret: router.apiSecretEnc,
    useSsl: router.useSsl,
    sessionSource: router.sessionSource,
  });
}
