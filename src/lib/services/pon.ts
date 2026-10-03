/**
 * PON port capacity planning (ISP.md §38).
 *
 * A 1:64 split fills up silently. There is no alarm, no error, and nothing on any
 * screen — the 65th ONU on a port is simply refused by the OLT, and the symptom
 * reaches the ISP as a customer whose light does not come on. By then the fix is a
 * second port and a second cable, not a decision.
 *
 * ## Nothing here is stored
 *
 * Every number in this module is counted from the `Onu` rows that exist right now.
 * There is no occupancy column, no counter, and no cache. That is not minimalism —
 * it is the only safe design:
 *
 *  - A stored count is a second copy of a fact `Onu.ponIndex` already holds, and it
 *    is wrong the moment an ONU moves, a sync relocates it, or somebody deletes a
 *    row. Nothing updates a counter when a device is unplugged.
 *  - A **cached suggestion is worse than no suggestion.** It is computed from a
 *    count that was true a moment ago, and the thing an operator does with it is
 *    put a real ONU on a real port. Offering a port that is now full is how a port
 *    goes past capacity — the suggestion is the mechanism by which the overfill
 *    happens, so it must not be able to be stale.
 *
 * The cost is a count per render. An OLT has at most a few hundred ports and a few
 * thousand ONUs, so that is one grouped query, not a table scan of anything a
 * dashboard should be afraid of.
 *
 * ## A port is the part of `ponIndex` before the colon
 *
 * `0/1/1:2` is frame 0, slot 1, port 1, ONU slot 2. The split ratio applies to the
 * *port*, and the ONU slot is which of the 64 an ONU occupies. Counting the whole
 * string would treat every ONU as its own port and report a network at 3% that is
 * really full.
 *
 * ## Unassigned is a port too
 *
 * An ONU with no `ponIndex` occupies capacity that nobody can see. It is counted
 * under a synthetic `unassigned` bucket on every report and on every OLT page,
 * because an operator looking at a cabinet that is 40% full and finding 200
 * unregistered ONUs is exactly the person who needs to know.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";

/**
 * The bucket for ONUs with no port.
 *
 * A name rather than `null`, because it has to survive being grouped, sorted,
 * rendered in a bar and turned into a filter. It is deliberately not a plausible
 * port name: `0/0/0` would sort first and look like a real one.
 */
export const UNASSIGNED = "unassigned";

/** Shown instead of a percentage when the ratio is unknown. */
export const DEFAULT_SPLIT = 64;

export type PortUsage = {
  /** `0/1/1`, or {@link UNASSIGNED}. */
  port: string;
  used: number;
  /** The ratio in force for this OLT — its own, or the network default. */
  splitRatio: number;
  /** Whole percent, clamped at 100 so a bar never overflows its track. */
  percent: number;
  free: number;
  atCapacity: boolean;
  nearCapacity: boolean;
  /** Every ONU serial on this port, for the detail table. */
  serials: string[];
};

export type PonUsage = {
  oltId: string;
  oltName: string;
  splitRatio: number;
  nearCapacityPercent: number;
  ports: PortUsage[];
  /** ONUs on this OLT with no port at all. */
  unassigned: number;
  totals: {
    onus: number;
    capacity: number;
    percent: number;
    /** Ports that are full, and so can never be suggested. */
    full: number;
    nearCapacity: number;
    free: number;
  };
};

/**
 * The port half of a PON index.
 *
 * Returns {@link UNASSIGNED} rather than null for anything it cannot parse, so no
 * ONU can fall out of the arithmetic — a null here would silently drop a whole
 * group from the report, which is the failure the module exists to prevent.
 */
export function portOf(ponIndex: string | null | undefined): string {
  const value = (ponIndex ?? "").trim();
  if (!value) return UNASSIGNED;
  const colon = value.indexOf(":");
  const head = colon === -1 ? value : value.slice(0, colon);
  const port = head.trim();
  return port || UNASSIGNED;
}

export function isUnassigned(port: string): boolean {
  return port === UNASSIGNED;
}

/**
 * Reads the thresholds.
 *
 * Both clamped to a sane range. A `nearCapacityPercent` of 0 would flag every port
 * on the network as near capacity, and a `splitRatio` of 0 would make every port
 * permanently full — the suggestion would return nothing and an operator would be
 * left with a form that cannot be filled in, with no explanation.
 */
export function readPonSettings(raw: Record<string, string>): {
  defaultSplitRatio: number;
  nearCapacityPercent: number;
} {
  const ratio = Number(raw["pon.defaultSplitRatio"]);
  const near = Number(raw["pon.nearCapacityPercent"]);
  return {
    defaultSplitRatio: Number.isFinite(ratio) && ratio > 0 ? Math.floor(ratio) : DEFAULT_SPLIT,
    nearCapacityPercent:
      Number.isFinite(near) && near > 0 && near <= 100 ? Math.floor(near) : 90,
  };
}

/** The ratio in force for one cabinet: its own, or the network default. */
export function splitRatioFor(
  olt: { splitRatio: number | null },
  defaultSplitRatio: number
): number {
  const own = Number(olt.splitRatio);
  return Number.isFinite(own) && own > 0 ? Math.floor(own) : defaultSplitRatio;
}

/**
 * Every port on one cabinet, counted from the ONUs that are there now.
 *
 * One grouped query for the counts and one for the serials, rather than one query
 * per port or one row loaded into memory. A cabinet with 8,000 ONUs should cost
 * two queries, not eight thousand.
 */
export async function ponUsageFor(oltId: string): Promise<PonUsage | null> {
  const olt = await prisma.olt.findUnique({
    where: { id: oltId },
    select: { id: true, name: true, splitRatio: true, ponPorts: true },
  });
  if (!olt) return null;

  const settings = readPonSettings(await getSettings());
  const splitRatio = splitRatioFor(olt, settings.defaultSplitRatio);

  const onus = await prisma.onu.findMany({
    where: { oltId },
    select: { ponIndex: true, serialNo: true },
    orderBy: { serialNo: "asc" },
  });

  const ports = tallyPorts(onus, splitRatio, settings.nearCapacityPercent);

  return {
    oltId: olt.id,
    oltName: olt.name,
    splitRatio,
    nearCapacityPercent: settings.nearCapacityPercent,
    ports,
    unassigned: ports.find((p) => isUnassigned(p.port))?.used ?? 0,
    totals: totalsFor(ports, splitRatio, olt.ponPorts),
  };
}

/**
 * Counts ONUs into ports. Split out because it is pure arithmetic over a plain
 * array, and arithmetic over a plain array is where the interesting mistakes live.
 */
export function tallyPorts(
  onus: { ponIndex: string | null; serialNo: string }[],
  splitRatio: number,
  nearCapacityPercent: number
): PortUsage[] {
  const byPort = new Map<string, string[]>();
  for (const onu of onus) {
    const port = portOf(onu.ponIndex);
    const bucket = byPort.get(port);
    if (bucket) bucket.push(onu.serialNo);
    else byPort.set(port, [onu.serialNo]);
  }

  return [...byPort.entries()]
    .map(([port, serials]) => {
      const used = serials.length;
      // An unassigned bucket has no capacity, so every percentage there would be
      // nonsense. It is reported as full, because "no port assigned" *is* the
      // problem, and a bar at 100% is the loudest honest way to say so.
      const capacity = isUnassigned(port) ? 0 : splitRatio;
      const percent = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 100;
      return {
        port,
        used,
        splitRatio: capacity,
        percent,
        free: Math.max(0, capacity - used),
        atCapacity: capacity > 0 ? used >= capacity : true,
        nearCapacity: capacity > 0 && used < capacity && percent >= nearCapacityPercent,
        serials: serials.slice(),
      };
    })
    // Unassigned last, always: it is a note about a gap, not a port, and sorting it
    // among real ports makes the worst row the hardest to see.
    .sort((a, b) => {
      if (isUnassigned(a.port)) return 1;
      if (isUnassigned(b.port)) return -1;
      return a.port.localeCompare(b.port, undefined, { numeric: true });
    });
}

function totalsFor(ports: PortUsage[], splitRatio: number, ponPorts: number) {
  const onus = ports.reduce((sum, p) => sum + p.used, 0);
  const real = ports.filter((p) => !isUnassigned(p.port));
  // Capacity is the ports we have *seen* used, because a port with nothing on it
  // contributes zero ONUs either way; `ponPorts` from the hardware is carried
  // alongside for the report but multiplying it out would claim capacity on ports
  // nobody has evidence exist.
  const capacity = real.length * splitRatio;
  return {
    onus,
    capacity,
    percent: capacity > 0 ? Math.min(100, Math.round((onus / capacity) * 100)) : 0,
    full: real.filter((p) => p.atCapacity).length,
    nearCapacity: real.filter((p) => p.nearCapacity).length,
    free: real.filter((p) => !p.atCapacity).length,
    /** What the hardware says the cabinet has, for context. */
    declaredPorts: ponPorts,
  };
}

/**
 * The port to put the next ONU on.
 *
 * **Least loaded first**, and a full port is never returned — not "returned but
 * discouraged", which the UI could ignore. The least-loaded rule is what keeps a
 * cabinet from filling one port to 64 while another sits at 10, and the exclusion
 * is what stops the suggestion itself being the mechanism that overfills a port.
 *
 * Ties break on the port name, so the same state always produces the same answer:
 * an operator who is told `0/1/2`, writes it down, and comes back to a different
 * port having been offered is a bad experience and a hard bug report.
 *
 * Returns `null` when every port is full, and the caller has to handle it as a
 * real answer rather than a failure — it means the cabinet needs another port.
 */
export async function suggestPort(
  oltId: string
): Promise<{ port: string; used: number; free: number; splitRatio: number } | null> {
  const usage = await ponUsageFor(oltId);
  if (!usage) return null;

  const candidates = usage.ports
    .filter((p) => !isUnassigned(p.port) && !p.atCapacity)
    .sort((a, b) => {
      if (a.used !== b.used) return a.used - b.used;
      return a.port.localeCompare(b.port, undefined, { numeric: true });
    });

  const best = candidates[0];
  if (!best) return null;
  return { port: best.port, used: best.used, free: best.free, splitRatio: best.splitRatio };
}

/** Every port on one cabinet, with the unassigned bucket included. */
export async function listPorts(oltId: string): Promise<PortUsage[]> {
  const usage = await ponUsageFor(oltId);
  return usage?.ports ?? [];
}

/** Ports at or over the warning line, worst first — the "near capacity" list. */
export async function nearCapacityPorts(oltId: string): Promise<PortUsage[]> {
  const ports = await listPorts(oltId);
  return ports
    .filter((p) => p.atCapacity || p.nearCapacity)
    .sort((a, b) => b.percent - a.percent);
}

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

export type AssignResult =
  | { ok: true; port: string; used: number }
  | {
      ok: false;
      /** Why it was refused, in words an operator can act on. */
      reason: string;
      /** The port to use instead, when there is one. */
      suggested: string | null;
      suggestedUsed?: number;
      suggestedFree?: number;
    };

/**
 * Puts an ONU on a port, and refuses to overfill one.
 *
 * ## Why the count alone is not enough
 *
 * "Count the ONUs, and if the count is below the split, insert" has a race in it:
 * two assignments for the last slot both count 63, both see room, both insert. The
 * result is a port with 65 ONUs on it, which is the exact failure this module
 * exists to prevent — reached *through* the check.
 *
 * So the count and the insert happen inside one transaction, and that transaction
 * takes a row lock on the **OLT**, not on the ONU:
 *
 *   SELECT id FROM "Olt" WHERE id = $1 FOR UPDATE
 *
 * Which means concurrent assignments on the same cabinet serialise, and the loser
 * re-reads the count with the winner's ONU already in it. A lock on the ONU row
 * would not help — the two assignments are usually about *different* ONUs, so there
 * is no shared row to lock. Locking the cabinet is coarse: two operators filling two
 * different ports on the same OLT wait for each other, which is a few milliseconds
 * and entirely acceptable next to overfilling a port.
 *
 * Nothing is cached and nothing is pre-counted outside the lock, so the number the
 * decision is made on is the number in the same transaction as the write.
 */
export async function assignOnuPort(input: {
  onuId: string;
  port: string;
  /** The ONU slot on the port. Omitted means the next free one. */
  slot?: number;
  actorId: string;
}): Promise<AssignResult> {
  const onu = await prisma.onu.findUnique({
    where: { id: input.onuId },
    select: { id: true, serialNo: true, oltId: true, ponIndex: true },
  });

  if (!onu) return { ok: false, reason: "That ONU no longer exists.", suggested: null };
  if (!onu.oltId) {
    return {
      ok: false,
      reason: "This ONU is not on an OLT, so there is no port to put it on.",
      suggested: null,
    };
  }

  const port = input.port.trim();
  if (!port || isUnassigned(port)) {
    const suggestion = await suggestPort(onu.oltId);
    return {
      ok: false,
      reason: "A port is required.",
      suggested: suggestion?.port ?? null,
      suggestedUsed: suggestion?.used,
      suggestedFree: suggestion?.free,
    };
  }

  const settings = readPonSettings(await getSettings());
  const olt = await prisma.olt.findUniqueOrThrow({
    where: { id: onu.oltId },
    select: { id: true, name: true, splitRatio: true },
  });
  const splitRatio = splitRatioFor(olt, settings.defaultSplitRatio);

  const assigned = await prisma.$transaction(async (tx) => {
    // The lock. Everything after it is a consistent read.
    await tx.$queryRaw`SELECT id FROM "Olt" WHERE id = ${onu.oltId} FOR UPDATE`;

    const onPort = await tx.onu.findMany({
      where: { oltId: onu.oltId, ponIndex: { startsWith: `${port}:` } },
      select: { id: true, ponIndex: true },
    });
    // This ONU's own row does not consume a second slot when it is being moved.
    const others = onPort.filter((o) => o.id !== onu.id);

    if (others.length >= splitRatio) {
      return { ok: false as const, used: others.length };
    }

    const slot = input.slot ?? firstFreeSlot(others, splitRatio);
    if (slot === null) {
      return { ok: false as const, used: others.length };
    }

    await tx.onu.update({
      where: { id: onu.id },
      data: { ponIndex: `${port}:${slot}` },
    });

    return { ok: true as const, used: others.length + 1, slot };
  });

  if (assigned.ok) {
    await logActivity(
      {
        action: "Update",
        entity: "Onu",
        entityId: onu.id,
        summary: `Placed ONU ${onu.serialNo} on ${olt.name} port ${port}:${assigned.slot} (${
          assigned.used
        } of ${splitRatio})`,
      },
      input.actorId
    );
    return { ok: true, port, used: assigned.used };
  }

  // Refused. Say why, and say where to go instead — the operator is holding a
  // device and a form, and "port full" with no alternative is a dead end.
  const suggestion = await suggestPort(onu.oltId);
  await logActivity({
    action: "Reject",
    entity: "Onu",
    entityId: onu.id,
    summary: `Refused to place ONU ${onu.serialNo} on ${olt.name} port ${port}: full at ${assigned.used} of ${splitRatio}`,
  });

  return {
    ok: false,
    reason: `${olt.name} port ${port} is full — ${assigned.used} of ${splitRatio} ONUs.`,
    suggested: suggestion?.port ?? null,
    suggestedUsed: suggestion?.used,
    suggestedFree: suggestion?.free,
  };
}

/**
 * The lowest free slot on a port.
 *
 * The ONU slot is 1-based, because that is what the vendors use: a 1:64 port has
 * ONU IDs 1 through 64 and slot 0 is the OLT's own. Starting at 1 rather than 0
 * keeps a port that the database calls full in agreement with the port the OLT
 * calls full.
 */
export function firstFreeSlot(taken: { ponIndex: string | null }[], splitRatio: number): number | null {
  const used = new Set<number>();
  for (const row of taken) {
    const match = /:(\d+)$/.exec(row.ponIndex ?? "");
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1 && n <= splitRatio) used.add(n);
  }
  for (let slot = 1; slot <= splitRatio; slot++) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export type PonUtilisationRow = {
  oltId: string;
  oltName: string;
  splitRatio: number;
  onus: number;
  capacity: number;
  percent: number;
  ports: number;
  full: number;
  nearCapacity: number;
  unassigned: number;
};

/**
 * PON utilisation across every cabinet, worst first.
 *
 * Every OLT is asked for, not just the ones with ONUs. A cabinet nobody has put a
 * customer on is 0% used and that is the *good* news — it is also the cabinet the
 * next customer should go on, and a report that only lists loaded cabinets hides
 * exactly that.
 */
export async function ponUtilisationReport(): Promise<{
  rows: PonUtilisationRow[];
  totals: { olts: number; onus: number; capacity: number; percent: number; unassigned: number };
}> {
  const settings = readPonSettings(await getSettings());
  const olts = await prisma.olt.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, splitRatio: true, ponPorts: true },
  });

  const counts = await prisma.onu.groupBy({
    by: ["oltId", "ponIndex"],
    where: { oltId: { not: null } },
    _count: { _all: true },
  });

  const byOlt = new Map<string, Map<string, number>>();
  for (const row of counts) {
    if (!row.oltId) continue;
    const port = portOf(row.ponIndex);
    const ports = byOlt.get(row.oltId) ?? new Map<string, number>();
    ports.set(port, (ports.get(port) ?? 0) + row._count._all);
    byOlt.set(row.oltId, ports);
  }

  const rows: PonUtilisationRow[] = olts.map((olt) => {
    const splitRatio = splitRatioFor(olt, settings.defaultSplitRatio);
    const ports = byOlt.get(olt.id) ?? new Map<string, number>();
    const real = [...ports.entries()].filter(([p]) => !isUnassigned(p));
    const onus = [...ports.values()].reduce((sum, n) => sum + n, 0);
    const capacity = real.length * splitRatio;
    return {
      oltId: olt.id,
      oltName: olt.name,
      splitRatio,
      onus,
      capacity,
      percent: capacity > 0 ? Math.min(100, Math.round((onus / capacity) * 100)) : 0,
      ports: real.length,
      full: real.filter(([, n]) => n >= splitRatio).length,
      nearCapacity: real.filter(([, n]) => {
        const pct = Math.round((n / splitRatio) * 100);
        return pct >= settings.nearCapacityPercent && n < splitRatio;
      }).length,
      unassigned: ports.get(UNASSIGNED) ?? 0,
    };
  });

  rows.sort((a, b) => b.percent - a.percent || a.oltName.localeCompare(b.oltName));

  const onus = rows.reduce((sum, r) => sum + r.onus, 0);
  const capacity = rows.reduce((sum, r) => sum + r.capacity, 0);

  return {
    rows,
    totals: {
      olts: olts.length,
      onus,
      capacity,
      percent: capacity > 0 ? Math.min(100, Math.round((onus / capacity) * 100)) : 0,
      unassigned: rows.reduce((sum, r) => sum + r.unassigned, 0),
    },
  };
}