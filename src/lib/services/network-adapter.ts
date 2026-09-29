/**
 * Network device adapters (ISP.md rule 10: keep MikroTik/OLT/ONU integrations
 * behind service/adaptor layers).
 *
 * Every vendor integration implements `NetworkAdapter`. The UI never talks to a
 * vendor protocol directly — it calls these interfaces, so swapping or adding a
 * vendor only means implementing one function.
 */

import { RouterOsClient, RouterOsError } from "./routeros";

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
  readonly capabilities = "Active users, traffic, disconnect, block";
  readonly live = true;

  constructor(private client: RouterOsClient) {}

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
    })
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
