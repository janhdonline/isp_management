/**
 * The OLT adapter seam.
 *
 * `NetworkAdapter` exists because MikroTik is one vendor among several and the
 * app must not be a MikroTik app with a router-shaped hole in it. The same
 * argument applies here with more force: OLT firmware differs between Huawei,
 * BDCom and VSOL not only in commands but in *where the information is*, so the
 * MIB layout is configuration and the code above this file never learns a vendor
 * name.
 *
 * The shape deliberately mirrors `NetworkAdapter`: a `live` flag so nothing can
 * report a simulated reading as a measured one, and methods that either return a
 * value or throw — never a half-filled object with `rxPower: undefined`, because
 * the difference between "the OLT said -18.4" and "we could not ask" is the
 * difference between a subscriber with a clean fibre and a subscriber somebody
 * should ring.
 */

/** One ONU as the OLT describes it. */
export type OnuReading = {
  serialNo: string;
  /** Which port it is on, in the OLT's own notation ("0/1/1:2"). */
  ponIndex: string | null;
  /** dBm. Negative. `null` means the OLT did not report it, not zero. */
  rxPower: number | null;
  txPower: number | null;
  /** The OLT's own word: Online, Offline, Low Signal. Never invented locally. */
  status: string;
};

export type PonPort = {
  /** `0/1/1` — the port, without the ONU slot. */
  port: string;
  /** How many slots the OLT reports on it. */
  slots: number;
  /** ONUs the OLT says are present. */
  onuCount: number;
};

export interface OltAdapter {
  readonly name: string;
  /**
   * False for the stand-in used when nothing is configured.
   *
   * The sync refuses to write a reading from a non-live adapter, which is what
   * stops a cabinet with no credentials from reporting a healthy zero ONUs and
   * quietly blanking its own subscribers.
   */
  readonly live: boolean;

  /** Everything the OLT says about every ONU it is serving. */
  discoverOnus(): Promise<OnuReading[]>;
  getOnuSignal(serial: string): Promise<OnuReading | null>;
  listPonPorts(): Promise<PonPort[]>;

  /** Write operations. These are the dangerous ones and are never called by a sync. */
  authorizeOnu(serial: string): Promise<boolean>;
  deauthorizeOnu(serial: string): Promise<boolean>;
  rebootOnu(serial: string): Promise<boolean>;
  factoryReset(serial: string): Promise<boolean>;

  /**
   * Which of the remote-control actions this adapter can actually carry out.
   *
   * Asked before a button is pressed rather than discovered from the exception
   * afterwards, because "this vendor's driver cannot reset a device" is a fact
   * worth showing an operator and not a failure they have to provoke. A driver that
   * does not override it claims all four, which is right for SNMP and wrong for
   * anything read-only — which is exactly why it is a method and not a constant.
   */
  capabilities(): OnuCapability[];
}

/**
 * `reset` is the factory reset, not a soft one. Named explicitly in the type
 * because "reset" and "reboot" are the pair people confuse, and the difference
 * between them is whether the device keeps its configuration.
 */
export type OnuCapability = "reboot" | "authorize" | "deauthorize" | "reset";

/** What the sync needs to know about a cabinet to build an adapter for it. */
export type OltRow = {
  id: string;
  name: string;
  ipAddress?: string | null;
  apiVendor?: string | null;
  snmpCommunityEnc?: boolean;
  snmpPort?: number | null;
};

/**
 * The stand-in, used when a cabinet has no vendor or no community configured.
 *
 * Every method fails with an explanation rather than returning an empty result. An
 * empty `discoverOnus()` is indistinguishable from a real OLT with nothing on it,
 * and the sync would happily mark every subscriber on that cabinet offline.
 */
export class UnconfiguredOltAdapter implements OltAdapter {
  readonly name = "No OLT adapter configured";
  readonly live = false;

  constructor(private reason: string) {}

  private fail(): never {
    throw new Error(this.reason);
  }

  async discoverOnus(): Promise<OnuReading[]> {
    this.fail();
  }
  async getOnuSignal(): Promise<OnuReading | null> {
    this.fail();
  }
  async listPonPorts(): Promise<PonPort[]> {
    this.fail();
  }
  async authorizeOnu(): Promise<boolean> {
    this.fail();
  }
  async deauthorizeOnu(): Promise<boolean> {
    this.fail();
  }
  async rebootOnu(): Promise<boolean> {
    this.fail();
  }
  async factoryReset(): Promise<boolean> {
    this.fail();
  }

  /**
   * Nothing, because there is nothing behind it.
   *
   * Returning `[]` rather than throwing is the point: the caller asks this to decide
   * whether to offer an action, and an exception at that moment would turn "this
   * cabinet is not set up" into "the page is broken".
   */
  capabilities(): OnuCapability[] {
    return [];
  }
}

/** Vendor code to adapter factory. */
export type OltAdapterFactory = (config: OltAdapterConfig) => Promise<OltAdapter>;

/**
 * Everything an adapter needs, assembled by the caller so that no adapter ever
 * reads Settings itself.
 *
 * The community is in here rather than being read from a closure, for two reasons:
 * it is the one field that must never be logged, and a single config object can be
 * redacted in one place (`safeConfig()`) instead of at every call site.
 */
export type OltAdapterConfig = {
  oltId: string;
  oltName: string;
  host: string;
  port: number;
  community: string;
  vendor: string;
  oids: VendorOids;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** SNMP retries. Kept small: a poll that takes a minute is worse than a failed one. */
  retries: number;
};

/**
 * The MIB layout for one vendor.
 *
 * Configuration rather than code, because these numbers are per-deployment: a
 * Huawei OLT answers on its enterprise tree, a BDCom on its own, and a vendor's
 * firmware revision moves a subtree without changing the model. Hardcoding them
 * would mean a firmware upgrade silently reads the wrong OIDs, which returns
 * plausible-looking garbage rather than an error.
 */
export type VendorOids = {
  /** Base of the vendor's ONU subtree. */
  onuBase: string;
  /** Table of serial-number-to-index, indexed by the ONU slot. */
  onuSerial: string;
  rxPower: string;
  txPower: string;
  status: string;
  /** `ponIndex` for a given index, if the vendor needs a walk to build it. */
  ponBase: string;
  /** The read/write community for write operations, when different. */
  writeCommunity?: string;
};

/**
 * Everything an adapter may be logged with.
 *
 * The community is the reason this function exists. Every log line, error message
 * and audit summary that mentions a cabinet goes through here, so there is one
 * place where the credential is dropped rather than N places where somebody has to
 * remember.
 */
export function safeConfig(config: OltAdapterConfig): Record<string, unknown> {
  return {
    olt: config.oltName,
    host: config.host,
    port: config.port,
    vendor: config.vendor,
    timeoutMs: config.timeoutMs,
    // Deliberately absent, and the absence is the point.
  };
}