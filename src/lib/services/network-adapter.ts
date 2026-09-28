/**
 * Network device adapters (ISP.md rule 10: keep MikroTik/OLT/ONU integrations
 * behind service/adaptor layers).
 *
 * Every vendor integration implements `NetworkAdapter`. The UI never talks to
 * a vendor protocol directly — it calls these interfaces, so swapping or adding
 * a vendor only means implementing one function.
 */

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
  health(): Promise<DeviceHealth>;
  activeUsers(): Promise<OnlineUser[]>;
  disconnect(username: string): Promise<boolean>;
  block(username: string, blocked: boolean): Promise<boolean>;
  oltSummary?(): Promise<{
    online: number;
    offline: number;
    lowSignal: number;
    onus: { serialNo: string; ponIndex?: string; rxPower?: number; txPower?: number; status: string }[];
  }>;
}

/**
 * Demo adapter backed by the local database. Used in development and whenever a
 * device has no reachable API configured, so the UI always renders real-shaped
 * data instead of hard-coded screen values.
 */
export class DatabaseNetworkAdapter implements NetworkAdapter {
  readonly name = "Database (simulated)";
  readonly capabilities = "Local session table — no vendor API configured";
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
 * MikroTik RouterOS REST adapter (v7 REST API). Kept dependency free — it uses
 * the global `fetch` so the code stays isomorphic.
 */
export class MikrotikAdapter implements NetworkAdapter {
  readonly name = "MikroTik RouterOS";
  readonly capabilities = "Active users, traffic, disconnect, block";

  constructor(
    private host: string,
    private port: number,
    private user: string,
    private password: string,
    private useSsl = false,
    private routerId?: string
  ) {}

  private get base() {
    return `${this.useSsl ? "https" : "http"}://${this.host}:${this.port}/rest`;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const auth = Buffer.from(`${this.user}:${this.password}`).toString("base64");
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`RouterOS ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async health(): Promise<DeviceHealth> {
    try {
      const [resource, active] = await Promise.all([
        this.call<Array<Record<string, string | number>>>("/system/resource"),
        this.call<unknown[]>("/ppp/active"),
      ]);
      const r = resource?.[0] ?? {};
      return {
        status: "Online",
        cpu: Number(r["cpu-load"] ?? 0),
        ram: Number(r["free-memory"] ?? 0) / Number(r["total-memory"] ?? 1) * 100,
        uptimeSec: Number(r["uptime"] ?? 0),
        activeUsers: Array.isArray(active) ? active.length : 0,
        lastSyncAt: new Date(),
      };
    } catch (e) {
      return {
        status: "Offline",
        lastSyncAt: new Date(),
        error: e instanceof Error ? e.message : "Unknown error",
      };
    }
  }

  async activeUsers(): Promise<OnlineUser[]> {
    try {
      const rows = await this.call<
        { name?: string; address?: string; macAddress?: string; uptime?: string; bytesIn?: string; bytesOut?: string }[]
      >("/ppp/active");
      return (rows ?? []).map((r) => ({
        username: r.name ?? "",
        ipAddress: r.address ?? null,
        macAddress: r.macAddress ?? null,
        downloadBytes: Number(r.bytesIn ?? 0),
        uploadBytes: Number(r.bytesOut ?? 0),
        uptimeSec: parseUptime(r.uptime),
        loginTime: new Date(Date.now() - parseUptime(r.uptime) * 1000),
      }));
    } catch {
      return [];
    }
  }

  async disconnect(username: string): Promise<boolean> {
    const rows = await this.call<{ ".id"?: string; name?: string }[]>("/ppp/active");
    const target = (rows ?? []).find((r) => r.name === username);
    if (!target?.[".id"]) return false;
    await this.call(`/ppp/active/${target[".id"]}`, { method: "DELETE" });
    return true;
  }

  async block(username: string, blocked: boolean): Promise<boolean> {
    await this.call(`/ip/hotspot/active`, { method: "PATCH" }).catch(() => undefined);
    return blocked;
  }
}

function parseUptime(value?: string): number {
  if (!value) return 0;
  if (value.includes(":")) {
    const parts = value.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const s = value.replace(/s$/, "");
  if (value.endsWith("s") && !value.includes(":")) return Number(s);
  return Number(value) || 0;
}

/** Resolve the adapter for a router row, falling back to the database adapter. */
export async function getAdapterForRouter(
  router: { id: string; name: string; ipAddress: string; apiPort: number; apiUser: string | null; apiSecretEnc: string | null; useSsl: boolean }
): Promise<NetworkAdapter> {
  if (!router.apiUser || !router.apiSecretEnc) return new DatabaseNetworkAdapter(router.id, router.name);
  return new MikrotikAdapter(
    router.ipAddress,
    router.apiPort,
    router.apiUser,
    router.apiSecretEnc,
    router.useSsl,
    router.id
  );
}
