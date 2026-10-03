/**
 * GIS fiber map and fault localization (ISP.md §35).
 *
 * A fiber cut takes down everyone behind it at once, and the two things an
 * operator needs are the same two things this module produces: *who* is affected,
 * and *where* to send the crew.
 *
 * ## Where the affected list comes from
 *
 * The hierarchy is already in the schema — `Customer → Onu → Olt`, with
 * `ponIndex` on the ONU — so an outage on one OLT resolves to its customers with
 * one query and no guesswork about geography. That is the important part: the
 * answer is derived from the PON topology, not from "which customers happen to be
 * in this postcode". A technician who walks out finds the fault where the map
 * already said the cabinet was.
 *
 * ## One incident, one ticket, one batch
 *
 * Every trigger resolves to an incident with a key of
 * `fault:{oltId}:{ponIndex}:{hourBucket}`, and three things hang off that key:
 *
 *   - one bulk ticket, claimed by `Ticket.dedupeKey` (unique);
 *   - one SMS batch, one queued row per customer, claimed by
 *     `Notification.idempotencyKey` (unique);
 *   - one recovery note when the trigger clears.
 *
 * The claims are unique indexes rather than lookups because the job runs from
 * three schedulers in this deployment. Two runs a minute apart both finding a
 * dead OLT is not a bug to guard against in application code — it is a race the
 * database has to lose one of. There is no "does this incident already exist"
 * check anywhere in here, because a check-then-insert is two queries and both of
 * them can pass the check.
 *
 * The ticket and its SMS batch are written in **one transaction**, so an incident
 * can never exist as a ticket nobody was told about, nor as messages pointing at
 * a ticket that was never created.
 *
 * ## The hour bucket is a backstop, not the mechanism
 *
 * Keeping one outage to one ticket is done by remembering the *open* incidents in
 * a settings row, so a fault lasting six hours still produces one ticket however
 * many times the job runs and whatever hour it crosses into. The hour bucket in
 * the key is the claim for the case that memory cannot help with: two processes
 * racing on a trigger neither has recorded yet. Once a run wins the claim, the
 * incident is recorded as open and the next run sees it and does nothing.
 *
 * ## A PON on a dead OLT is not a second incident
 *
 * When an OLT goes down, every ONU behind it reads Offline too. Without a guard
 * the OLT rule and the ONU-cluster rule would both fire on the same physical
 * event and open two tickets for one cut — the second finding every customer
 * already on the first. So the cluster rule skips any PON whose OLT is itself
 * offline: that event is already being localized, at the better resolution.
 *
 * ## Transitions, not states
 *
 * Like Phase I (ISP.md §32), an OLT that was already Offline the first time this
 * job ran does not generate an incident. Nobody said anything was wrong, so
 * nothing is. Without this, deploying the job would open a ticket for every OLT a
 * deployment happens to inherit.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { nextNumber } from "@/lib/counter";
import { prismaLog } from "@/lib/services/activity";
import type { JobResult } from "@/lib/services/job-result";

/** The ticket category for a fiber incident. Added to `COMPLAINT_CATEGORIES`. */
export const FIBER_CATEGORY = "Fiber Fault";

/**
 * The `ponIndex` slot for an incident on the OLT as a whole rather than one port.
 * A dead OLT takes every port with it, so there is no single port to name.
 */
export const WHOLE_OLT = "all";

/**
 * The `Notification.template` values this module queues.
 *
 * Exported, and imported by `sendScheduledMessages`, because that worker's
 * `idempotencyKey: null` filter is the only thing standing between a queued
 * fiber message and being silently undelivered for ever. Sharing one constant
 * means renaming a template cannot half-happen and quietly stop the sends.
 */
export const FIBER_TEMPLATES = ["fiber-outage", "fiber-recovery"] as const;

/** How long an incident stays open if the trigger never clears. */
const INCIDENT_TTL_MS = 24 * 3_600_000;

/** Cross-run memory. See "Transitions, not states" above. */
const STATE_KEY = "faults.stateStore";

/**
 * A customer never gets an outage notice for a line they no longer hold.
 *
 * Deliberately not `{ in: ["Active"] }`: a suspended customer still has a line
 * that went dark and still deserves to be told. Only a disconnected one does not.
 */
const LIVE_CONNECTION = { not: "Disconnected" };

export type MapFeatureKind = "olt" | "router" | "onu" | "area";

export type MapFeature = {
  id: string;
  kind: MapFeatureKind;
  name: string;
  lat: number;
  lng: number;
  status: string;
  /** Whatever the inspector should show: PON port, area, serial, clients. */
  detail: string;
};

export type MapRoute = {
  id: string;
  name: string;
  points: { lat: number; lng: number }[];
  note: string | null;
  olt: string | null;
  area: string | null;
};

export type AffectedCustomer = {
  id: string;
  name: string;
  phone: string;
  areaId: string | null;
  areaName: string | null;
};

export type Incident = {
  key: string;
  kind: "olt" | "pon";
  oltId: string;
  oltName: string;
  ponIndex: string;
  affected: AffectedCustomer[];
  /** Where to send the crew. See `locate()`. */
  pin: { lat: number; lng: number; source: string } | null;
};

export type IncidentOutcome = {
  key: string;
  kind: "olt" | "pon";
  oltName: string;
  ponIndex: string;
  affected: number;
  /** False when a concurrent run won the claim. */
  ticketCreated: boolean;
  queued: number;
};

/** An incident that has started and not yet recovered. */
export type OpenIncident = {
  key: string;
  kind: "olt" | "pon";
  oltId: string;
  oltName: string;
  ponIndex: string;
  at: string;
  /** Optimisation for the recovery pass; recovered from the key when absent. */
  ticketId: string | null;
};

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The key that makes an incident exactly-once.
 *
 * `hourBucket` is floored to the hour. It bounds a *claim*, not an outage: open
 * incidents are remembered separately, so a fault running from 23:50 to 00:20 is
 * still one incident. See the module comment.
 */
export function faultKey(
  oltId: string,
  ponIndex: string,
  at: Date = new Date()
): string {
  const bucket = new Date(at);
  bucket.setMinutes(0, 0, 0);
  return `fault:${oltId}:${ponIndex}:${bucket.getHours().toString().padStart(2, "0")}`;
}

/**
 * Key for one recipient's outage message.
 *
 * Keyed on the **ticket**, not on the incident key. The incident key carries an
 * hour bucket, and a key built from it means a customer can be told about at most
 * one outage an hour: two separate cuts in the same hour produce a second ticket
 * (the first was resolved, so its claim is free) but the second ticket's messages
 * collide with the first's and are silently dropped. The ticket id is unique per
 * incident and is exactly the granularity wanted — one batch per ticket.
 *
 * Keyed on the ticket this way also means an outage that runs past an hour
 * boundary stays one batch, because it only ever has one ticket.
 */
export function outageKey(ticketId: string, customerId: string): string {
  return `fault:sms:${ticketId}:${customerId}`;
}

/** Key for one recipient's recovery message. Same reasoning as `outageKey`. */
export function recoveryKey(ticketId: string, customerId: string): string {
  return `fault:recovery:${ticketId}:${customerId}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type FaultSettings = {
  enabled: boolean;
  /** ONUs that must drop on one port before it counts as a cut. */
  threshold: number;
  /** The window those drops have to fall inside. */
  windowMinutes: number;
  /** Whether recovery sends a second message. Off by default. */
  notifyRecovery: boolean;
};

/**
 * Reads the thresholds.
 *
 * Both numbers are clamped to at least 1. A setting of `0` would make *every*
 * offline ONU an incident, and on a deployment whose ONU status field has gone
 * stale that is several thousand tickets in one run — a bad number in Settings
 * should produce a useless localization, not a mail storm. A non-numeric value
 * falls back to the default rather than becoming `NaN`, which would make every
 * comparison false and the job silently do nothing.
 */
export function readFaultSettings(raw: Record<string, string>): FaultSettings {
  const threshold = Number(raw["faults.onuClusterThreshold"]);
  const window = Number(raw["faults.onuClusterWindowMinutes"]);
  return {
    enabled: raw["faults.enabled"] !== "false",
    threshold: Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : 5,
    windowMinutes: Number.isFinite(window) && window >= 1 ? Math.floor(window) : 10,
    notifyRecovery: raw["faults.notifyRecovery"] === "true",
  };
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

/**
 * Whether a coordinate pair is a usable position.
 *
 * `(0, 0)` is rejected on purpose. It is the one pair that is almost always a
 * "not filled in" that parsed as a number, and it is in the Gulf of Guinea — so
 * accepting it puts an unlocated device in the ocean off West Africa, which reads
 * as a bug and is worse than leaving the device off the map.
 */
export function isUsablePoint(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (lat as number) >= -90 &&
    (lat as number) <= 90 &&
    (lng as number) >= -180 &&
    (lng as number) <= 180 &&
    !((lat as number) === 0 && (lng as number) === 0)
  );
}

/**
 * The same test, narrowed to a position — or `null` when the pair is unusable.
 *
 * A type predicate can only narrow one parameter, and a map marker needs *both*
 * coordinates known to be numbers. Every caller wants the same thing, so the
 * narrowing lives here once rather than being re-asserted at each call site.
 */
export function asPoint(
  lat: unknown,
  lng: unknown
): { lat: number; lng: number } | null {
  return isUsablePoint(lat, lng)
    ? { lat: lat as number, lng: lng as number }
    : null;
}

type Positioned = { latitude: number | null; longitude: number | null };

const NOWHERE: Positioned = { latitude: null, longitude: null };

/**
 * Where to send the crew.
 *
 * A chain, and the order is the point. The OLT's own cabinet is the real answer:
 * a fiber fault is repaired at the break or the splice, and the OLT is the one
 * node whose position is the thing that broke. The area centroid is next — the
 * right town, not the right building. The centroid of the affected ONUs is a last
 * resort and is genuinely useful, because it is computed from the customers who
 * actually lost service.
 *
 * `null` means nothing anywhere is positioned, and the ticket says so rather than
 * inventing a pin.
 */
export function locate(
  olt: Positioned,
  area: Positioned,
  onus: Positioned[]
): { lat: number; lng: number; source: string } | null {
  const cabinet = asPoint(olt.latitude, olt.longitude);
  if (cabinet) return { ...cabinet, source: "OLT cabinet" };

  const centre = asPoint(area.latitude, area.longitude);
  if (centre) return { ...centre, source: "area centre" };

  const placed = onus.map((o) => asPoint(o.latitude, o.longitude)).filter((p) => p !== null);
  if (!placed.length) return null;
  const lat = placed.reduce((sum, o) => sum + o.lat, 0) / placed.length;
  const lng = placed.reduce((sum, o) => sum + o.lng, 0) / placed.length;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    source: `centroid of ${placed.length} located ONU${placed.length === 1 ? "" : "s"}`,
  };
}

/** A clickable link to the pin, for a technician whose phone has no signal. */
export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

// ---------------------------------------------------------------------------
// Map features
// ---------------------------------------------------------------------------

/**
 * Every positioned device, for the map.
 *
 * One query per device type rather than a join: a map of 4,000 ONUs and 40 OLTs
 * is rebuilt on every page load, and a nested include over the customer graph
 * would drag the billing data along with it.
 */
export async function mapFeatures(): Promise<MapFeature[]> {
  const [olts, routers, onus] = await Promise.all([
    prisma.olt.findMany({
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        status: true,
        location: true,
        ponPorts: true,
        area: { select: { name: true } },
        _count: { select: { onus: true } },
      },
    }),
    prisma.router.findMany({
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        status: true,
        location: true,
        activeUsers: true,
        area: { select: { name: true } },
      },
    }),
    prisma.onu.findMany({
      select: {
        id: true,
        name: true,
        serialNo: true,
        latitude: true,
        longitude: true,
        status: true,
        ponIndex: true,
        rxPower: true,
        olt: { select: { name: true } },
        area: { select: { name: true } },
        _count: { select: { customers: true } },
      },
    }),
  ]);

  const features: MapFeature[] = [];

  for (const o of olts) {
    const point = asPoint(o.latitude, o.longitude);
    if (!point) continue;
    features.push({
      id: o.id,
      kind: "olt",
      name: o.name,
      lat: point.lat,
      lng: point.lng,
      status: o.status,
      detail: [
        `OLT · ${o._count.onus} ONU${o._count.onus === 1 ? "" : "s"} on ${o.ponPorts} PON port${o.ponPorts === 1 ? "" : "s"}`,
        o.area ? `area ${o.area.name}` : o.location ? o.location : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const r of routers) {
    const point = asPoint(r.latitude, r.longitude);
    if (!point) continue;
    features.push({
      id: r.id,
      kind: "router",
      name: r.name,
      lat: point.lat,
      lng: point.lng,
      status: r.status,
      detail: [
        "Router",
        `${r.activeUsers} active user${r.activeUsers === 1 ? "" : "s"}`,
        r.area ? `area ${r.area.name}` : r.location ? r.location : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const o of onus) {
    const point = asPoint(o.latitude, o.longitude);
    if (!point) continue;
    features.push({
      id: o.id,
      kind: "onu",
      name: o.name || o.serialNo,
      lat: point.lat,
      lng: point.lng,
      status: o.status,
      detail: [
        `ONU ${o.serialNo}${o.ponIndex ? ` · PON ${o.ponIndex}` : ""}`,
        o.rxPower != null ? `rx ${o.rxPower.toFixed(1)} dBm` : null,
        o.olt ? `via ${o.olt.name}` : null,
        o.area ? `area ${o.area.name}` : null,
        o._count.customers
          ? `${o._count.customers} customer${o._count.customers === 1 ? "" : "s"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return features;
}

/**
 * Fiber routes, for the map's polylines.
 *
 * A route whose stored `points` cannot be read is dropped rather than thrown on.
 * `points` is free-form JSON, and one bad row must not take the whole map down
 * with it; the count of what was dropped is in the result so the page can say so.
 */
export async function mapRoutes(): Promise<{ routes: MapRoute[]; skipped: number }> {
  const rows = await prisma.fiberRoute.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      points: true,
      note: true,
      olt: { select: { name: true } },
      area: { select: { name: true } },
    },
  });

  const routes: MapRoute[] = [];
  let skipped = 0;

  for (const row of rows) {
    const points = parsePoints(row.points);
    if (!points.length) {
      skipped += 1;
      continue;
    }
    routes.push({
      id: row.id,
      name: row.name,
      points,
      note: row.note,
      olt: row.olt?.name ?? null,
      area: row.area?.name ?? null,
    });
  }

  return { routes, skipped };
}

/**
 * Reads a stored route into points.
 *
 * Written as a parser rather than a cast because the column is `Json`: the value
 * can be anything that predates this code, or anything a hand-written INSERT put
 * there. A waypoint with two non-numeric strings must not take the map down, and
 * must not quietly become a pin in the middle of the ocean.
 */
export function parsePoints(raw: unknown): { lat: number; lng: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { lat: number; lng: number }[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const point = asPoint(
      (p as { lat?: unknown }).lat,
      (p as { lng?: unknown }).lng
    );
    if (!point) continue;
    out.push(point);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

type OltSnapshot = { status: string; at: string };

/**
 * Turns the current state of the network into the incidents that have just
 * started, and the ones that have just ended.
 *
 * `applyState: false` runs the detection against a throwaway state, for callers
 * that want to see what would happen without changing what is remembered.
 */
export async function detectIncidents(
  now: Date = new Date(),
  options: { applyState?: boolean } = {}
): Promise<{ started: Incident[]; resolved: OpenIncident[] }> {
  const applyState = options.applyState !== false;
  const settings = readFaultSettings(await getSettings());
  const open = await readState<OpenIncident>("open");
  const snapshot = await readState<OltSnapshot>("oltStatus");

  const [olts, onus] = await Promise.all([
    prisma.olt.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        latitude: true,
        longitude: true,
        areaId: true,
        area: { select: { latitude: true, longitude: true } },
      },
    }),
    prisma.onu.findMany({
      select: {
        id: true,
        oltId: true,
        ponIndex: true,
        status: true,
        latitude: true,
        longitude: true,
        lastSeenAt: true,
      },
    }),
  ]);

  const started: Incident[] = [];
  const resolved: OpenIncident[] = [];
  const nextOpen: Record<string, OpenIncident> = { ...open };

  // --- The OLT rule -------------------------------------------------------
  //
  // Online → Offline, and only that. A dead OLT the job has already localized
  // stays one ticket; a dead OLT seen for the first time is not an incident.
  const offlineOltIds = new Set<string>();
  for (const olt of olts) {
    const slot = `olt:${olt.id}`;
    const wasUp = snapshot[olt.id]?.status;

    if (olt.status === "Offline") {
      offlineOltIds.add(olt.id);
      if (wasUp === "Online") {
        const incident = await buildIncident({
          key: faultKey(olt.id, WHOLE_OLT, now),
          kind: "olt",
          oltId: olt.id,
          oltName: olt.name,
          ponIndex: WHOLE_OLT,
          where: { oltId: olt.id },
          onus: onus.filter((o) => o.oltId === olt.id),
          olt: {
            latitude: olt.latitude,
            longitude: olt.longitude,
            area: olt.area ?? NOWHERE,
          },
        });
        started.push(incident);
        nextOpen[slot] = {
          key: incident.key,
          kind: "olt",
          oltId: olt.id,
          oltName: olt.name,
          ponIndex: WHOLE_OLT,
          at: now.toISOString(),
          ticketId: null,
        };
      }
      continue;
    }

    // Back up: only an OLT reading Online counts as recovered. "Unknown" is
    // silence, not service.
    if (olt.status === "Online" && nextOpen[slot]) {
      resolved.push(nextOpen[slot]);
      delete nextOpen[slot];
    }
  }

  // --- The ONU-cluster rule ----------------------------------------------
  //
  // N ONUs on one (oltId, ponIndex), offline, each last seen alive inside the
  // window. `lastSeenAt` is the honest clock for "dropped together": the job only
  // sees status at its own run boundaries, so two ONUs that dropped in the same
  // run are indistinguishable from two that dropped a second apart — unless
  // something records when each was last seen alive, which `localizeFaults` does.
  const cutoff = now.getTime() - settings.windowMinutes * 60_000;
  const groups = new Map<string, typeof onus>();
  for (const onu of onus) {
    if (onu.status !== "Offline") continue;
    if (!onu.oltId || !onu.ponIndex) continue;
    // Skipped when its OLT is down: that event is already open at better
    // resolution, and without this the same cut raises two tickets.
    if (offlineOltIds.has(onu.oltId)) continue;
    const slot = `pon:${onu.oltId}:${onu.ponIndex}`;
    const bucket = groups.get(slot);
    if (bucket) bucket.push(onu);
    else groups.set(slot, [onu]);
  }

  // Slots that are over the threshold *right now*, as opposed to the ones this
  // run happens to have re-added. The distinction is the whole recovery test: a
  // cluster that dropped from six dark ONUs to four has not been re-detected,
  // and asking "did we add it again this run" would answer no to that and to a
  // cluster that is still very much down.
  const activeSlots = new Set<string>();

  for (const [slot, members] of groups) {
    if (members.length < settings.threshold) continue;
    // Every member has to be recent. One member that has been dark for a week is
    // a dead ONU that happens to share a port with a genuine cut, and counting it
    // would lower the bar for every cluster on the network.
    const recent = members.filter(
      (m) => m.lastSeenAt != null && m.lastSeenAt.getTime() >= cutoff
    );
    if (recent.length < settings.threshold) continue;
    activeSlots.add(slot);
    if (nextOpen[slot]) continue; // Already open: still one ticket.

    const olt = olts.find((o) => o.id === members[0].oltId);
    if (!olt) continue;
    const ponIndex = members[0].ponIndex as string;
    const incident = await buildIncident({
      key: faultKey(olt.id, ponIndex, now),
      kind: "pon",
      oltId: olt.id,
      oltName: olt.name,
      ponIndex,
      where: { oltId: olt.id, ponIndex },
      onus: members,
      olt: {
        latitude: olt.latitude,
        longitude: olt.longitude,
        area: olt.area ?? NOWHERE,
      },
    });
    started.push(incident);
    nextOpen[slot] = {
      key: incident.key,
      kind: "pon",
      oltId: olt.id,
      oltName: olt.name,
      ponIndex,
      at: now.toISOString(),
      ticketId: null,
    };
  }

  // The recovered half of the PON rule: a port that is no longer over the
  // threshold, or whose ONUs have come back, ends its incident. A port that
  // emptied from six dark ONUs to four is over — the incident was five.
  for (const slot of Object.keys(open)) {
    if (!slot.startsWith("pon:")) continue;
    if (activeSlots.has(slot)) continue;
    resolved.push(open[slot]);
    delete nextOpen[slot];
  }

  if (applyState) {
    const stamps: Record<string, OltSnapshot> = {};
    for (const o of olts) {
      stamps[o.id] = { status: o.status, at: now.toISOString() };
    }
    await writeState("oltStatus", stamps);
    await writeState("open", nextOpen);
  }

  return { started, resolved };
}

async function buildIncident(input: {
  key: string;
  kind: "olt" | "pon";
  oltId: string;
  oltName: string;
  ponIndex: string;
  where: { oltId: string; ponIndex?: string };
  onus: { latitude: number | null; longitude: number | null }[];
  olt: { latitude: number | null; longitude: number | null; area: Positioned };
}): Promise<Incident> {
  return {
    key: input.key,
    kind: input.kind,
    oltId: input.oltId,
    oltName: input.oltName,
    ponIndex: input.ponIndex,
    affected: await affectedCustomers(input.where),
    pin: locate(input.olt, input.olt.area, input.onus),
  };
}

/**
 * Who is affected, through the PON topology.
 *
 * One query: the ONUs are read with their customer, which is how the link is
 * meant to be traversed since it is one-to-one. A disconnected customer is left
 * out — their line is gone, and "there is an outage in your area" is both wrong
 * and the kind of message that gets an ISP reported as spamming.
 */
export async function affectedCustomers(where: {
  oltId: string;
  ponIndex?: string;
}): Promise<AffectedCustomer[]> {
  const onus = await prisma.onu.findMany({
    where: {
      ...where,
      customers: { some: { connectionStatus: LIVE_CONNECTION } },
    },
    select: {
      customers: {
        where: { connectionStatus: LIVE_CONNECTION },
        select: {
          id: true,
          name: true,
          phone: true,
          areaId: true,
          area: { select: { name: true } },
        },
      },
    },
  });

  const byId = new Map<string, AffectedCustomer>();
  for (const onu of onus) {
    for (const c of onu.customers) {
      if (byId.has(c.id)) continue;
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        phone: c.phone,
        areaId: c.areaId,
        areaName: c.area?.name ?? null,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which area a bulk ticket is routed to.
 *
 * The most common area among the affected customers, not the OLT's area. An OLT
 * usually serves more than one, and the crew who have to walk out is the one that
 * owns the streets with the most dark customers — the ticket must not route on a
 * technical parent when the work is a distribution one. Ties break on the area
 * name so the same outage always routes the same way.
 */
export function dominantArea(customers: AffectedCustomer[]): string | null {
  const tally = new Map<string, { name: string; n: number }>();
  for (const c of customers) {
    if (!c.areaId) continue;
    const entry = tally.get(c.areaId);
    if (entry) entry.n += 1;
    else tally.set(c.areaId, { name: c.areaName ?? "", n: 1 });
  }

  let best: string | null = null;
  let bestRow: { name: string; n: number } | null = null;
  for (const [id, row] of tally) {
    if (!bestRow || row.n > bestRow.n || (row.n === bestRow.n && row.name < bestRow.name)) {
      best = id;
      bestRow = row;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/**
 * Localizes every new fiber incident, and closes the ones that have recovered.
 *
 * Runs after `deviceHealthWatch` in the job list, so it reads the statuses that
 * watch compared against rather than racing it.
 */
export async function localizeFaults(now: Date = new Date()): Promise<JobResult> {
  const settings = readFaultSettings(await getSettings());
  if (!settings.enabled) {
    return { ran: 0, skipped: "Fault localization is switched off in Settings → Network." };
  }

  // `lastSeenAt` first, before detection reads it. It is the only clock the
  // cluster rule has for "when did these drop together", and the only writer of
  // that column is this job. One statement for every online ONU rather than one
  // per ONU: a 4,000-ONU network must not become 4,000 round trips a night.
  const live = await prisma.onu.findMany({
    where: { status: "Online" },
    select: { id: true },
  });
  if (live.length) {
    await prisma.onu.updateMany({
      where: { id: { in: live.map((o) => o.id) } },
      data: { lastSeenAt: now },
    });
  }

  await pruneOpenIncidents(now);

  const { started, resolved } = await detectIncidents(now);

  const outcomes: IncidentOutcome[] = [];
  for (const incident of started) {
    outcomes.push(await raise(incident, now));
  }
  const recovered = await recoverAll(resolved, now);

  const raised = outcomes.filter((o) => o.ticketCreated).length;
  const queued = outcomes.reduce((sum, o) => sum + o.queued, 0);
  const lost = outcomes.length - raised;

  return {
    ran: raised + recovered,
    skipped:
      `${started.length} new incident(s): ${raised} ticket(s) opened, ${queued} message(s) queued` +
      (lost ? `, ${lost} claimed by a concurrent run` : "") +
      (resolved.length ? `, ${recovered} recovered` : ""),
  };
}

/**
 * Opens the bulk ticket and queues the SMS batch, exactly once.
 *
 * One transaction for both. The ticket's `dedupeKey` insert is the claim: the
 * loser of a race gets `P2002` from the index and returns having written nothing,
 * because the SMS rows are in the same transaction and roll back with it.
 *
 * Nothing is sent from here — the messages are queued and the messaging cron
 * delivers them. A fiber fault is also a perfectly plausible reason the SMS
 * provider is unreachable, and a transaction must not hold a socket open while it
 * finds out.
 */
export async function raise(
  incident: Incident,
  now: Date = new Date()
): Promise<IncidentOutcome> {
  const notified = incident.affected.filter((c) => !!c.phone);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ticketNumber = await nextNumber(tx, "ticket", "TKT-");
      const created = await tx.ticket.create({
        data: {
          ticketNumber,
          // A bulk ticket belongs to no single customer. The affected list lives
          // in the description and the first comment, and stays re-derivable from
          // the ONUs, which is why no link table is needed.
          customerId: null,
          areaId: dominantArea(incident.affected),
          subject: fiberSubject(incident),
          problem: FIBER_CATEGORY,
          category: FIBER_CATEGORY,
          description: fiberDescription(incident, now),
          priority: incident.kind === "olt" ? "Critical" : "High",
          status: "Open",
          dedupeKey: incident.key,
          comments: {
            create: {
              authorName: "Fault localization",
              isInternal: true,
              body: affectedComment(incident),
            },
          },
        },
      });

      // `skipDuplicates` rather than a plain insert: the ticket claim above means
      // only one run reaches this line, but a customer behind two dead ONUs is
      // already on the first incident's batch, and should be told once.
      const batch = notified.length
        ? await tx.notification.createMany({
            data: notified.map((c) => ({
              channel: "SMS",
              recipient: c.phone,
              customerId: c.id,
              template: "fiber-outage",
              subject: null,
              body: OUTAGE_BODY,
              status: "Scheduled",
              scheduledAt: now,
              idempotencyKey: outageKey(created.id, c.id),
              notes: `fiber fault ${incident.key} (${incident.oltName} PON ${incident.ponIndex})`,
            })),
            skipDuplicates: true,
          })
        : { count: 0 };

      await prismaLog(tx, {
        action: "Create",
        entity: "Ticket",
        entityId: created.id,
        summary:
          `Fiber incident ${incident.key}: ${notified.length} customer(s) affected on ` +
          `${incident.oltName}${incident.kind === "pon" ? ` PON ${incident.ponIndex}` : ""}`,
      });

      return { id: created.id, queued: batch.count };
    });

    await attachTicket(incident, result.id);

    return {
      key: incident.key,
      kind: incident.kind,
      oltName: incident.oltName,
      ponIndex: incident.ponIndex,
      affected: incident.affected.length,
      ticketCreated: true,
      queued: result.queued,
    };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Another run got there first. Its ticket and its batch stand; this run
    // writes nothing, which is the entire contract.
    return {
      key: incident.key,
      kind: incident.kind,
      oltName: incident.oltName,
      ponIndex: incident.ponIndex,
      affected: incident.affected.length,
      ticketCreated: false,
      queued: 0,
    };
  }
}

/**
 * Notes the ticket an open incident belongs to, so recovery can find it.
 *
 * A compare-and-swap against the exact serialized row: on a concurrent run the
 * other process may have advanced this state, and last-writer-wins would
 * overwrite its ticket id with one that does not exist. If the swap loses, nothing
 * is written — recovery falls back to looking the ticket up by its `dedupeKey`,
 * which is unique, so the note still lands on the right ticket.
 */
async function attachTicket(incident: Incident, ticketId: string): Promise<void> {
  const slot = openSlot(incident.kind, incident.oltId, incident.ponIndex);
  const open = await readState<OpenIncident>("open");
  const current = open[slot];
  if (!current || current.key !== incident.key) return;

  await prisma.setting.updateMany({
    where: { key: `${STATE_KEY}.open`, value: JSON.stringify(open) },
    data: {
      value: JSON.stringify({ ...open, [slot]: { ...current, ticketId } }),
    },
  });
}

function openSlot(kind: "olt" | "pon", oltId: string, ponIndex: string): string {
  return kind === "olt" ? `olt:${oltId}` : `pon:${oltId}:${ponIndex}`;
}

/** The ticket an incident belongs to, found by its unique key. */
export async function ticketForKey(key: string): Promise<string | null> {
  const row = await prisma.ticket.findFirst({
    where: { dedupeKey: key },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Closes incidents whose trigger has cleared.
 *
 * A note on the ticket and a status change, not a second message. The customers
 * were told a team was dispatched and it was, and "your internet is back" is a
 * third message to somebody who has just had a bad hour. It is available behind
 * a setting for the deployments that want it.
 */
export async function recoverAll(
  resolved: OpenIncident[],
  now: Date = new Date()
): Promise<number> {
  const settings = readFaultSettings(await getSettings());
  let done = 0;

  for (const incident of resolved) {
    // The recorded id is an optimisation; the key is the truth. A run that lost
    // the attach race still recovers the right ticket.
    const ticketId = incident.ticketId ?? (await ticketForKey(incident.key));
    if (!ticketId) continue;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true },
    });
    // Already resolved: a repeated recovery pass must not stack duplicate
    // recovery notes on the same ticket.
    if (!ticket || ticket.status === "Resolved" || ticket.status === "Closed") continue;

    const minutes = Math.max(
      0,
      Math.round((now.getTime() - new Date(incident.at).getTime()) / 60_000)
    );

    await prisma.$transaction(async (tx) => {
      await tx.ticketComment.create({
        data: {
          ticketId: ticket.id,
          authorName: "Fault localization",
          isInternal: true,
          body:
            `Service restored after ${formatDuration(minutes)}. Trigger cleared at ` +
            `${now.toISOString().replace("T", " ").slice(0, 16)} UTC.`,
        },
      });
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          status: "Resolved",
          resolvedAt: now,
          // Freed, so a later incident on the same port can be opened. A resolved
          // ticket and an open incident are contradictory, and the key is only
          // unique while it still means "this incident is open".
          dedupeKey: null,
        },
      });
      await prismaLog(tx, {
        action: "Resolve",
        entity: "Ticket",
        entityId: ticket.id,
        summary: `Fiber incident ${incident.key} recovered after ${formatDuration(minutes)}.`,
      });
    });

    if (settings.notifyRecovery) {
      await queueRecovery(incident, ticket.id, now);
    }

    done += 1;
  }

  return done;
}

async function queueRecovery(
  incident: OpenIncident,
  ticketId: string,
  now: Date
): Promise<void> {
  // The affected list is re-resolved rather than read off the ticket: it is
  // derived from the ONUs, and re-deriving it is how a customer who has moved
  // area since the outage is still reached on the right number.
  const affected = await affectedCustomers(
    incident.kind === "pon"
      ? { oltId: incident.oltId, ponIndex: incident.ponIndex }
      : { oltId: incident.oltId }
  );
  const notified = affected.filter((c) => !!c.phone);
  if (!notified.length) return;

  await prisma.notification.createMany({
    data: notified.map((c) => ({
      channel: "SMS",
      recipient: c.phone,
      customerId: c.id,
      template: "fiber-recovery",
      subject: null,
      body: RECOVERY_BODY,
      status: "Scheduled",
      scheduledAt: now,
      idempotencyKey: recoveryKey(ticketId, c.id),
      notes: `fiber recovery ${incident.key}`,
    })),
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * The customer-facing outage message.
 *
 * A constant, not a template: it does not vary with the incident, and a template
 * with no variables in it is one more thing to change by accident.
 *
 * Short on purpose. An SMS has room for about 160 characters before the handset
 * splits it into segments, and a customer reading this on a phone with no service
 * wants two things: is it just me, and is anyone coming.
 */
export const OUTAGE_BODY =
  "ISP notice: there is a fiber fault in your area. A team has been dispatched and will update you shortly.";

/** The recovery notice. Only queued when `faults.notifyRecovery` is on. */
export const RECOVERY_BODY =
  "Your area's fiber service has been restored. Sorry for the trouble.";

function fiberSubject(incident: Incident): string {
  return incident.kind === "olt"
    ? `Fiber outage — ${incident.oltName} offline`
    : `Fiber outage — ${incident.oltName} PON ${incident.ponIndex}`;
}

/**
 * The ticket description: where, how many, and how it was decided.
 *
 * The pin comes first, because the first thing a technician does with a ticket is
 * open the map. The customer list is capped — a 900-customer cut does not belong
 * in a `description` column as 900 lines, and the full list stays one query away
 * from the ONUs.
 */
function fiberDescription(incident: Incident, now: Date): string {
  const lines: string[] = [];
  lines.push(
    incident.pin
      ? `Location: ${incident.pin.lat}, ${incident.pin.lng} (${incident.pin.source}) — ${mapLink(incident.pin.lat, incident.pin.lng)}`
      : "Location: not recorded — no coordinates on the OLT, its area, or any affected ONU. Ask the office where the cabinet is before dispatching."
  );
  lines.push(`Affected customers: ${incident.affected.length}`);
  lines.push(
    `Source: ${
      incident.kind === "olt"
        ? `OLT ${incident.oltName} went offline`
        : `${incident.oltName} PON ${incident.ponIndex} cluster failure`
    }, detected ${now.toISOString().replace("T", " ").slice(0, 19)} UTC.`
  );
  lines.push(`Incident key: ${incident.key}`);
  if (incident.affected.length) {
    const shown = incident.affected.slice(0, 25);
    lines.push(
      `Customers: ${shown
        .map((c) => `${c.name}${c.areaName ? ` (${c.areaName})` : ""}`)
        .join(", ")}` +
        (incident.affected.length > shown.length
          ? `, and ${incident.affected.length - shown.length} more.`
          : ".")
    );
  }
  return lines.join("\n");
}

function affectedComment(incident: Incident): string {
  const rows = incident.affected
    .slice(0, 200)
    .map((c) => `${c.name} — ${c.phone}${c.areaName ? ` — ${c.areaName}` : ""}`);
  const rest = incident.affected.length - rows.length;
  return [
    `Affected by ${incident.key}: ${incident.affected.length} customer(s).`,
    ...rows,
    ...(rest > 0 ? [`…and ${rest} more.`] : []),
  ].join("\n");
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

// ---------------------------------------------------------------------------
// Cross-run state
// ---------------------------------------------------------------------------

async function readState<T>(slot: string): Promise<Record<string, T>> {
  const row = await prisma.setting.findUnique({ where: { key: `${STATE_KEY}.${slot}` } });
  if (!row?.value) return {} as Record<string, T>;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, T>)
      : ({} as Record<string, T>);
  } catch {
    return {} as Record<string, T>;
  }
}

async function writeState<T>(slot: string, value: Record<string, T>): Promise<void> {
  const key = `${STATE_KEY}.${slot}`;
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: json, group: "Network" },
    update: { value: json },
  });
}

/**
 * Drops incident records older than the TTL: a port that never recovers, or a
 * deployment that loses its state row. Without it the open set would grow for
 * ever and every run would carry it around.
 */
export async function pruneOpenIncidents(now: Date = new Date()): Promise<number> {
  const open = await readState<OpenIncident>("open");
  let dropped = 0;
  for (const slot of Object.keys(open)) {
    const at = new Date(open[slot].at).getTime();
    if (Number.isFinite(at) && now.getTime() - at < INCIDENT_TTL_MS) continue;
    delete open[slot];
    dropped += 1;
  }
  if (dropped) await writeState("open", open);
  return dropped;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2002" || /unique constraint/i.test(msg);
}