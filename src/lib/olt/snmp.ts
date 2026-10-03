import snmp from "net-snmp";
import {
  UnconfiguredOltAdapter,
  type OltAdapter,
  type OltAdapterConfig,
  type OnuReading,
  type PonPort,
  type VendorOids,
  safeConfig,
} from "./adapter";
import { normaliseSerial, statusFromOnuState } from "./oid-maps";

/**
 * The generic SNMP driver.
 *
 * One driver for all three vendors, because SNMP is one protocol and the vendors
 * differ only in their MIB layout — which is exactly what `VendorOids` carries.
 * A vendor that needs a genuinely different protocol (NETCONF, a vendor cloud API,
 * an SSH channel) gets its own adapter behind the same `OltAdapter` interface, and
 * nothing above this file changes.
 *
 * ## The read/write community split
 *
 * `authorizeOnu`, `deauthorizeOnu` and `rebootOnu` are **write** operations on
 * subscriber hardware. They use `writeCommunity` when one is configured and fall
 * back to the read community when it is not — which is a deliberate footgun guard:
 * a deployment that only configured a read community can still discover and read,
 * and the write calls will be refused by the OLT rather than silently doing
 * something. `OltAdapterConfig` is the only place the two communities meet, and
 * `safeConfig()` is the only place a config is turned into something loggable.
 */

/**
 * Reads one subtree and groups the varbinds by the OID they answered on.
 *
 * `subtree()` takes a single root, so this takes one root too — the grouping is
 * what lets the caller ask for four leaves and correlate them, which it would
 * otherwise have to do by index arithmetic on OID suffixes.
 *
 * An error resolves to `{}` rather than rejecting. SNMP's failure modes are not
 * exceptions in any useful sense — a timeout, an auth failure and a wrong community
 * all arrive the same way — and the caller needs to tell "nothing answered" from
 * "nothing is there", which means it needs the fact, not an exception it will turn
 * into the same generic message.
 */
function readSubtree(session: SnmpSession, oid: string): Promise<snmp.Varbind[]> {
  return new Promise((resolve) => {
    const collected: snmp.Varbind[] = [];
    // `subtree` streams: `feedCb` is called per varbind and `doneCb` once at the
    // end. The timeout and retry count live on the session, not on the call.
    session.subtree(
      oid,
      // The feed callback gets a batch of varbinds and must return true to keep
      // the walk going; returning anything else stops it early and silently
      // truncates the table.
      (batch: snmp.Varbind[]) => {
        collected.push(...batch);
        return true;
      },
      (error: Error | null) => {
        // An error resolves to whatever arrived rather than rejecting: a subtree
        // that timed out half way has real readings in it, and the caller is better
        // served by three ONUs' signal levels plus a partial flag than by nothing.
        void error;
        resolve(collected);
      }
    );
  });
}

/** `integer(2)` for a number, `octetString(4)` for a string. */
function setOid(session: SnmpSession, oid: string, value: number | string): Promise<boolean> {
  return new Promise((resolve) => {
    session.set(
      [{ oid, type: typeof value === "number" ? 2 : 4, value: value as never }],
      (error) => resolve(!error)
    );
  });
}

/** `1.3.6.1.4.1.…` → `…:2` style slot labels are vendor-specific, so this is derived. */
/**
 * How a slot index is rendered into `Onu.ponIndex`.
 *
 * A slot number on its own is not a port: the same slot 3 exists on every PON port
 * on the cabinet. `slot:3` is therefore a *vendor-reported identifier*, not a
 * `frame/slot` pair, and it deliberately does not pretend to be one — a value that
 * looks like `0/1/1:3` and is really only the last part would be worse than an
 * obviously partial one, because somebody would trust it.
 */
function slotFromIndex(index: number): string {
  return `slot:${index}`;
}

/**
 * The bit of `net-snmp` this adapter uses.
 *
 * Declared here rather than taking `snmp.Session` directly so the driver can be
 * driven by a fake session in a test. That is not a testing convenience: everything
 * in `walkOnus` that can be wrong — correlating four column walks by the index in
 * the OID suffix rather than by row order, treating 9999 as "no reading" rather
 * than a light level, refusing to guess an unrecognised status code — is logic, and
 * logic deserves tests that do not need a UDP socket to answer.
 *
 * The real `snmp.Session` satisfies this. `net-snmp`'s agent-based test double in
 * `tests/mock-olt-snmp.mjs` speaks the real protocol; where it serves, the
 * integration tests use it.
 */
export type SnmpSession = {
  subtree(
    oid: string,
    feedCb: (varbinds: snmp.Varbind[]) => boolean,
    doneCb: (error: Error | null) => void
  ): unknown;
  set(varbinds: snmp.Varbind[], responseCb: (error: Error | null) => void): unknown;
  close(): void;
};

export type SessionFactory = (community: string) => SnmpSession;

export class SnmpOltAdapter implements OltAdapter {
  readonly name = "SNMP";
  readonly live = true;

  /**
   * @param openSession Overridden in tests. Production always uses `net-snmp`.
   */
  constructor(
    private config: OltAdapterConfig,
    private openSession?: SessionFactory
  ) {}

  /**
   * A read session.
   *
   * The community is `createSession`'s second argument, not an option — and it is
   * passed straight in from `this.config.community` with nothing in between that
   * could log it or put it in an error message.
   */
  private open(): SnmpSession {
    if (this.openSession) return this.openSession(this.config.community);
    return snmp.createSession(this.config.host, this.config.community, {
      version: snmp.Version2c,
      port: this.config.port,
      timeout: this.config.timeoutMs,
      retries: this.config.retries,
      transport: "udp4",
    });
  }

  /**
   * A session authorised to write.
   *
   * A separate session rather than a mutated one, so a read can never inherit the
   * write community by accident and a write can never be issued on a connection
   * that was set up for reading.
   */
  private openWrite(): SnmpSession {
    const community = this.config.oids.writeCommunity || this.config.community;
    if (this.openSession) return this.openSession(community);
    return snmp.createSession(this.config.host, community, {
      version: snmp.Version2c,
      port: this.config.port,
      timeout: this.config.timeoutMs,
      retries: this.config.retries,
      transport: "udp4",
    });
  }

  /** One pass over the ONU table, whatever the vendor's leaf names are. */
  private async walkOnus(): Promise<OnuReading[]> {
    const { oids } = this.config;
    const session = this.open();

    try {
      const [serialRows, rxRows, txRows, statusRows] = await Promise.all([
        readSubtree(session, oids.onuSerial),
        readSubtree(session, oids.rxPower),
        readSubtree(session, oids.txPower),
        readSubtree(session, oids.status),
      ]);

      if (!serialRows.length) return [];

      /** The slot index a varbind's OID carries, or null if it is not a row. */
      const slotOf = (vb: snmp.Varbind, oid: string): number | null => {
        const prefix = `${oid}.`;
        if (!vb.oid.startsWith(prefix)) return null;
        const index = vb.oid.slice(prefix.length);
        return /^\d+$/.test(index) ? Number(index) : null;
      };

      const serialBySlot = new Map<number, string>();
      for (const vb of serialRows) {
        const serialNo = normaliseSerial(vb.value);
        // No serial means no ONU: this is the slot table answering, not a device.
        if (!serialNo) continue;
        const slot = slotOf(vb, oids.onuSerial);
        if (slot === null) continue;
        serialBySlot.set(slot, serialNo);
      }

      // The signal columns are read per slot, not positionally. Assuming
      // row N of the rx table belongs to row N of the serial table is exactly the
      // bug that makes a dashboard show four subscribers' light levels shuffled
      // between them — every value plausible, every one wrong.
      const powerBySlot = (rows: snmp.Varbind[], oid: string): Map<number, number> => {
        const out = new Map<number, number>();
        for (const vb of rows) {
          const slot = slotOf(vb, oid);
          if (slot === null) continue;
          const v = Number(vb.value);
          // 9999 and -9999 are every vendor's "no reading". Without this, an ONU
          // that has never transmitted reads as impossibly healthy and never trips
          // the low-signal alert.
          if (!Number.isFinite(v) || v >= 9999 || v <= -9999) continue;
          out.set(slot, v);
        }
        return out;
      };

      const stateBySlot = new Map<number, number>();
      for (const vb of statusRows) {
        const slot = slotOf(vb, oids.status);
        if (slot === null) continue;
        stateBySlot.set(slot, Number(vb.value));
      }

      const rxBySlot = powerBySlot(rxRows, oids.rxPower);
      const txBySlot = powerBySlot(txRows, oids.txPower);

      return [...serialBySlot.entries()].map(([slot, serialNo]) => ({
        serialNo,
        ponIndex: `${slotFromIndex(slot)}`,
        rxPower: rxBySlot.get(slot) ?? null,
        txPower: txBySlot.get(slot) ?? null,
        status: statusFromOnuState(stateBySlot.get(slot)),
      }));
    } finally {
      session.close();
    }
  }

  async discoverOnus(): Promise<OnuReading[]> {
    const readings = await this.walkOnus();
    // An OLT that answered but reported nothing is a fact worth distinguishing
    // from one that never answered; the caller decides what to do about it.
    if (!readings.length) {
      throw new Error(
        `${this.config.oltName} answered SNMP but reported no ONUs. Check the OID map in Settings → Network — wrong OIDs look exactly like an empty OLT.`
      );
    }
    return readings;
  }

  async getOnuSignal(serial: string): Promise<OnuReading | null> {
    const wanted = serial.trim().toLowerCase();
    const readings = await this.walkOnus();
    return readings.find((r) => r.serialNo.toLowerCase() === wanted) ?? null;
  }

  async listPonPorts(): Promise<PonPort[]> {
    const { oids } = this.config;
    const session = this.open();
    try {
      const rows = await readSubtree(session, oids.ponBase);
      const ports = new Map<string, number>();
      for (const row of rows) {
        // `ponBase.<frame>.<slot>.<ifIndex>` — the frame and slot are the port.
        const suffix = row.oid.slice(`${oids.ponBase}.`.length).split(".");
        if (suffix.length < 2) continue;
        const port = `${suffix[0]}/${suffix[1]}`;
        ports.set(port, (ports.get(port) ?? 0) + 1);
      }
      return [...ports.entries()].map(([port, slots]) => ({ port, slots, onuCount: 0 }));
    } finally {
      session.close();
    }
  }

  private async write(serial: string, leaf: string, value: number | string): Promise<boolean> {
    const wanted = serial.trim().toLowerCase();
    const readings = await this.walkOnus();
    const match = readings.find((r) => r.serialNo.toLowerCase() === wanted);
    if (!match) return false;

    const session = this.openWrite();
    try {
      // The ONU table is a column store: the leaf under the same slot row. Using
      // the serial as an index would write to whichever ONU happens to be first.
      const serialRows = await readSubtree(session, this.config.oids.onuSerial);
      const row = serialRows.find(
        (vb) => String(vb.value).trim().toLowerCase() === wanted
      );
      if (!row) return false;
      const slot = row.oid.slice(`${this.config.oids.onuSerial}.`.length).split(".")[0];
      const base = this.config.oids.onuBase.replace(/\.$/, "");
      return await setOid(session, `${base}.${slot}.${leaf}`, value);
    } finally {
      session.close();
    }
  }

  /**
   * Authorises an ONU — removes the "new, unprovisioned" state.
   *
   * Deliberately not automatic anywhere. `deauthorizeOnu` cuts a subscriber's
   * line, and that belongs to a person deciding to, not to a sync noticing a value.
   */
  async authorizeOnu(serial: string): Promise<boolean> {
    return this.write(serial, "authorize", 1);
  }

  async deauthorizeOnu(serial: string): Promise<boolean> {
    return this.write(serial, "authorize", 2);
  }

  async rebootOnu(serial: string): Promise<boolean> {
    return this.write(serial, "reset", 1);
  }

  /** For a config dump with the credential provably absent. */
  describe(): Record<string, unknown> {
    return safeConfig(this.config);
  }
}

/**
 * Builds the adapter for one cabinet, or explains why there is not one.
 *
 * Every branch that refuses says which of the two things is missing, because
 * "no OLT adapter configured" leaves an operator guessing which of the two fields
 * on the row they have not filled in.
 */
export function adapterForOlt(input: {
  oltId: string;
  oltName: string;
  host: string | null;
  apiVendor: string | null;
  community: string | null;
  snmpPort?: number | null;
  oids: VendorOids;
  /** Overridden in tests; see `SessionFactory`. */
  openSession?: SessionFactory;
}): OltAdapter {
  const { openSession } = input;
  if (!input.host) {
    return new UnconfiguredOltAdapter(
      `${input.oltName} has no management IP address, so there is nothing to poll.`
    );
  }
  if (!input.apiVendor) {
    return new UnconfiguredOltAdapter(
      `${input.oltName} has no API vendor set, so it is not polled. That is a choice — the cabinet is left as it is rather than reported as empty.`
    );
  }
  if (!input.community) {
    return new UnconfiguredOltAdapter(
      `${input.oltName} has no SNMP community configured. Set one in Settings → Network and tick the OLT's community box.`
    );
  }

  const port = Number(input.snmpPort);
  return new SnmpOltAdapter({
    oltId: input.oltId,
    oltName: input.oltName,
    host: input.host,
    // A default that would never be a real answer is better than a NaN that
    // silently becomes 0 and points the session at port 0.
    port: Number.isFinite(port) && port > 0 ? port : 161,
    community: input.community,
    vendor: input.apiVendor,
    oids: input.oids,
    timeoutMs: 2_000,
    retries: 1,
  }, openSession);
}
