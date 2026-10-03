/**
 * Resolves an `Olt` row into an adapter, reading the community out of Settings.
 *
 * This is the only place in the application where the SNMP community is read, and
 * it is read into a local variable that is never returned, logged or passed
 * anywhere except the adapter's own constructor. `safeConfig()` in `adapter.ts` is
 * how an adapter describes itself for a log line, and the community is absent from
 * it.
 */

import { getSettings } from "@/lib/settings";
import { adapterForOlt } from "./snmp";
import { parseOidMap, resolveOids, vendorKey, VENDORS, type VendorKey } from "./oid-maps";
import type { OltAdapter, OltRow } from "./adapter";

export * from "./adapter";
export { VENDORS, vendorKey } from "./oid-maps";

/** The community for a vendor: its own override, or the shared default. */
export function communityFor(
  settings: Record<string, string>,
  vendor: string | null | undefined
): string | null {
  const key = vendorKey(vendor);
  const specific = key ? (settings[`network.snmpCommunity.${key}`] ?? "").trim() : "";
  if (specific) return specific;
  const shared = (settings["network.snmpCommunity"] ?? "").trim();
  return shared || null;
}

/**
 * The adapter for one cabinet.
 *
 * Reads Settings on each call rather than caching, because Settings can change
 * while the process runs and a half-applied change here means polling the wrong
 * community against real hardware.
 */
export async function oltAdapterFor(row: OltRow): Promise<OltAdapter> {
  const settings = await getSettings();
  const key = vendorKey(row.apiVendor);
  const community = communityFor(settings, row.apiVendor);

  // An unknown vendor gets the shared default map rather than a random one: the
  // shapes are the same, the numbers differ, and reading a Huawei map off a BDCom
  // would return nothing — which the sync would report as "reported no ONUs",
  // pointing an operator at the wrong cabinet's settings.
  const resolved = key ?? ("huawei" as VendorKey);
  const { oids, dropped } = resolveOids(resolved, parseOidMap(settings[`network.olt.oidMap.${resolved}`]));
  if (dropped.length) {
    console.warn(
      `[olt] ignoring ${dropped.join(", ")} in the ${resolved} OID map: not a numeric OID`
    );
  }

  return adapterForOlt({
    oltId: row.id,
    oltName: row.name,
    host: row.ipAddress ?? null,
    apiVendor: row.apiVendor ?? null,
    community,
    snmpPort: row.snmpPort,
    oids,
  });
}

/** The vendors an operator can choose, for the OLT form. */
export function vendorOptions(): { value: string; label: string }[] {
  return (Object.keys(VENDORS) as VendorKey[]).map((k) => ({
    value: `snmp-${k}`,
    label: VENDORS[k].label,
  }));
}