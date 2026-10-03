import type { VendorOids } from "./adapter";

/**
 * Per-vendor MIB layouts.
 *
 * ## Why these are Settings and not code
 *
 * A Huawei OLT answers on the Huawei enterprise subtree, a BDCom on its own, a
 * VSOL on its own. Those three numbers are not a property of this application —
 * they are a property of a particular model running a particular firmware, and
 * both Huawei and BDCom have moved subtrees between firmware revisions. Hardcoding
 * them means a firmware upgrade silently answers on the wrong OIDs, and the wrong
 * OIDs return *plausible garbage* rather than an error: a serial index that reads
 * as an empty string, an rx power that comes back as 0.
 *
 * So each map lives in Settings as JSON and is merged over these defaults at
 * runtime. An operator whose OLT answers somewhere else overrides four values in
 * the settings screen instead of waiting for a build.
 *
 * ## The defaults are placeholders, and are meant to be replaced
 *
 * These are the vendors' standard enterprise subtrees with the conventional leaf
 * names. **They are not verified against any specific hardware.** They are here so
 * that the mechanism — the map, the merge, the walk, the reading — is real and
 * testable, and so an operator has a starting point to correct. `README` and the
 * Settings hint both say so, and the sync reports "no OID map" rather than reading
 * zeros when a map is missing.
 *
 * The one thing that is *not* a placeholder is `status`, whose values are the
 * integers the GPON standard assigns and which every vendor implements identically.
 */

export type VendorKey = "huawei" | "bdcom" | "vsol";

export const VENDORS: Record<VendorKey, { label: string; oids: VendorOids }> = {
  huawei: {
    label: "Huawei (SmartAX MA-series)",
    oids: {
      // Huawei enterprise subtree.
      onuBase: "1.3.6.1.4.1.2011.2.25.188",
      onuSerial: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.2",
      rxPower: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.6",
      txPower: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.7",
      status: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.5",
      ponBase: "1.3.6.1.4.1.2011.2.25.188.1.3.6.1.2",
    },
  },
  bdcom: {
    label: "BDCom (EPON OLT)",
    oids: {
      // BDCom enterprise subtree.
      onuBase: "1.3.6.1.4.1.20274",
      onuSerial: "1.3.6.1.4.1.20274.5.1.1.2.1.2",
      rxPower: "1.3.6.1.4.1.20274.5.1.1.2.1.5",
      txPower: "1.3.6.1.4.1.20274.5.1.1.2.1.6",
      status: "1.3.6.1.4.1.20274.5.1.1.2.1.4",
      ponBase: "1.3.6.1.4.1.20274.5.1.1.1.1",
    },
  },
  vsol: {
    label: "VSOL",
    oids: {
      // VSOL enterprise subtree.
      onuBase: "1.3.6.1.4.1.40000",
      onuSerial: "1.3.6.1.4.1.40000.4.1.1.2.1.2",
      rxPower: "1.3.6.1.4.1.40000.4.1.1.2.1.5",
      txPower: "1.3.6.1.4.1.40000.4.1.1.2.1.6",
      status: "1.3.6.1.4.1.40000.4.1.1.2.1.4",
      ponBase: "1.3.6.1.4.1.40000.4.1.1.1.1",
    },
  },
};

/** `snmp-huawei` on an OLT row, or `huawei`. */
export function vendorKey(apiVendor: string | null | undefined): VendorKey | null {
  const value = (apiVendor ?? "").trim().toLowerCase();
  if (!value) return null;
  const bare = value.replace(/^snmp-/, "");
  return bare in VENDORS ? (bare as VendorKey) : null;
}

/**
 * A single numeric OID, or null when the text is not one.
 *
 * Not defensive programming for its own sake: a subtree copied out of a wiki with
 * a stray space or a `0x` prefix is the single most likely way this setting gets
 * wrong, and `net-snmp` would treat it as a valid-looking name and return nothing,
 * which the sync would report as "the OLT says every ONU is absent".
 */
function oid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^0x/i, "");
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * The map to use for a vendor: defaults, with Settings laid over them.
 *
 * A partial override is the normal case — one firmware revision moved one leaf —
 * so the merge is per-field rather than whole-map. An invalid override is dropped
 * rather than merged, and the caller is told how many were dropped, because a
 * silently-ignored typo is how somebody spends an afternoon wondering why their
 * override did nothing.
 */
export function resolveOids(
  key: VendorKey,
  overrides: Record<string, string> | null
): { oids: VendorOids; dropped: string[] } {
  const oids = { ...VENDORS[key].oids };
  const dropped: string[] = [];

  if (!overrides) return { oids, dropped };

  for (const field of Object.keys(oids) as (keyof VendorOids)[]) {
    if (field === "writeCommunity") continue;
    const raw = overrides[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const parsed = oid(raw);
    if (!parsed) {
      dropped.push(field);
      continue;
    }
    (oids as Record<string, string>)[field] = parsed;
  }

  return { oids, dropped };
}

/** Parses an OID map out of a Settings value. Never throws. */
export function parseOidMap(raw: string | null | undefined): Record<string, string> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The OLT's numeric ONU states, per ITU-T G.984 / G.9807.
 *
 * Every vendor implements these the same way, which is why this is code rather
 * than configuration. An *unrecognised* value is `Unknown`, never guessed — a
 * vendor-specific state code turned into "Offline" would mass-disconnect
 * subscribers whose ONUs are perfectly healthy but happen to report a code this
 * table has not been taught.
 */
export function statusFromOnuState(value: number | null | undefined): string {
  switch (value) {
    case 1:
      return "Offline";
    case 2:
      return "Online";
    case 3:
      return "Low Signal";
    case 4:
      return "Testing";
    case 5:
      return "Dying";
    case 6:
      return "Dead";
    case 7:
      return "Absent";
    case 8:
      return "LOS";
    default:
      return "Unknown";
  }
}

/** Serial numbers arrive with vendor whitespace and sometimes as hex. */
export function normaliseSerial(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "N/A" || /^0+$/.test(trimmed)) return null;
  return trimmed;
}