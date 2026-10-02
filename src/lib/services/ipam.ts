/**
 * IP pool management (ISP.md §34).
 *
 * `Customer.ipAddress` was free text. Two customers could be given the same
 * address, nothing showed what was free, and a duplicate-IP outage is a matter of
 * time rather than a matter of if. This makes the subnet the unit an operator
 * thinks in and every address in it a row that either is or is not taken.
 *
 * ## The unique index is the design
 *
 * Allocation is check-then-allocate: find a free address, then claim it. Two
 * operators doing that at the same instant both read "free" and both write — two
 * statements, and the gap between them is where a duplicate comes from. So the
 * check is not the guarantee; `IpAllocation.ip` being unique is. Both racers
 * attempt the same insert, the index lets one through, and the other comes back
 * as a unique violation which `allocate()` turns into "already allocated".
 *
 * That is also why the error handling exists at all: the collision is not a
 * programming error, it is the mechanism working.
 *
 * ## Existing addresses are adopted, never clobbered
 *
 * The migration adds empty tables and touches nothing. `Customer.ipAddress` holds
 * whatever years of operators typed into it, some of it not an address in any
 * pool. Adoption is a deliberate action (`adoptExisting`) because it can only be
 * done correctly by somebody who can see the pool and the customer together —
 * which the migration cannot.
 */

import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/counter";
import {
  allocatableAddresses,
  parseCidr,
  parseIpv4,
  formatIpv4,
  sortKeyFor,
  type ParsedCidr,
} from "@/lib/services/cidr";

export type IpStatus = "Free" | "Reserved" | "Allocated";

/* ------------------------------------------------------------------ */
/* Pools                                                               */
/* ------------------------------------------------------------------ */

/**
 * Creates a pool and expands it into one `Free` row per allocatable address.
 *
 * All in one transaction: a pool that exists without its rows would report 100%
 * free and hand out addresses that collide with nothing — because nothing knows
 * they exist.
 */
export async function createPool(input: {
  name: string;
  cidr: string;
  gateway?: string | null;
  dns?: string | null;
  routerId?: string | null;
  areaId?: string | null;
  note?: string | null;
}): Promise<{ poolId: string; total: number }> {
  const parsed = parseCidr(input.cidr);
  if (!parsed) {
    throw new Error(
      `"${input.cidr}" is not a valid IPv4 CIDR block (expected something like 10.10.10.0/24).`
    );
  }

  const gateway = input.gateway?.trim() || null;
  if (gateway && !parsedContains(parsed, gateway)) {
    throw new Error(
      `The gateway ${gateway} is outside ${input.cidr}, so the pool could never route.`
    );
  }

  const addresses = allocatableAddresses(parsed, gateway);

  return prisma.$transaction(async (tx) => {
    const pool = await tx.ipPool.create({
      data: {
        name: input.name.trim(),
        // Stored canonically, so "10.0.5.3/24" and "10.0.5.0/24" cannot be two
        // pools that are really the same subnet.
        cidr: formatIpv4(parsed.network) + "/" + parsed.prefix,
        gateway,
        dns: input.dns?.trim() || null,
        routerId: input.routerId || null,
        areaId: input.areaId || null,
      },
      select: { id: true },
    });

    // createMany rather than a loop: a /16 is 65 534 rows and one insert is the
    // difference between a second and a minute.
    await tx.ipAllocation.createMany({
      data: addresses.map((ip) => ({
        ip,
        sortKey: sortKeyFor(ip),
        poolId: pool.id,
        status: "Free" as const,
      })),
      // A pool overlapping an existing one would collide here, and the index
      // rejects it rather than merging two subnets into one ambiguous set.
      skipDuplicates: false,
    });

    return { poolId: pool.id, total: addresses.length };
  });
}

function parsedContains(p: ParsedCidr, ip: string): boolean {
  const v = parseIpv4(ip);
  return v !== null && v >= p.network && v <= p.broadcast;
}

/* ------------------------------------------------------------------ */
/* Allocation                                                          */
/* ------------------------------------------------------------------ */

export type AllocateResult =
  | { ok: true; ip: string; allocationId: string; releasedPrevious: string | null }
  | { ok: false; error: string };

/**
 * Hands an address to a customer, writing the allocation and `Customer.ipAddress`
 * in one transaction.
 *
 * Both writes together because they are one fact. A customer with an IP address
 * the allocation table does not know about is an address the next operator will
 * hand to somebody else.
 *
 * Race-safe by construction: the free-address lookup is an optimisation, and the
 * unique index is the guarantee. A loser of the race gets a unique violation and
 * is told the address is taken, rather than a partial write.
 */
export async function allocate(
  customerId: string,
  opts: { ip?: string | null; poolId?: string | null } = {}
): Promise<AllocateResult> {
  // A caller-named address has no alternative, so it is one attempt. An
  // auto-assign is "the next free one" and the pool has capacity — losing the race
  // for .2 because another operator took it a millisecond earlier is not a reason to
  // tell this customer the pool is full, so it retries down the list.
  return opts.ip
    ? allocateOne(customerId, opts)
    : allocateNextFree(customerId, opts, AUTO_ASSIGN_ATTEMPTS);
}

/** How many times an auto-assign retries after losing a race before giving up. */
const AUTO_ASSIGN_ATTEMPTS = 8;

async function allocateNextFree(
  customerId: string,
  opts: { poolId?: string | null },
  attempts: number
): Promise<AllocateResult> {
  let last = "There are no free addresses left in any pool.";
  for (let i = 0; i < attempts; i++) {
    const r = await allocateOne(customerId, opts);
    if (r.ok) return r;
    last = r.error;
    // Out of addresses, not a lost race — retrying cannot help.
    if (!/a moment ago|somebody else/i.test(r.error)) return r;
  }
  return { ok: false, error: last };
}

async function allocateOne(
  customerId: string,
  opts: { ip?: string | null; poolId?: string | null }
): Promise<AllocateResult> {
  // Serialise per customer, so two requests for the *same* customer cannot each
  // pick a free address and then have one of them lose to the customerId index.
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`;

  return prisma.$transaction(async (tx) => {
    let allocation: { id: string; ip: string } | null = null;

    if (opts.ip) {
      const wanted = opts.ip.trim();
      const found = await tx.ipAllocation.findUnique({ where: { ip: wanted } });
      if (!found) {
        return { ok: false, error: `${wanted} is not in any pool.` } as const;
      }
      if (found.customerId && found.customerId !== customerId) {
        return {
          ok: false,
          error: `${wanted} is already allocated to another customer.`,
        } as const;
      }
      allocation = { id: found.id, ip: found.ip };
    } else {
      // "Next free": the lowest free address in the pool, ordered by `sortKey`
      // rather than by the address text — a lexical sort of "10.30.0.10" against
      // "10.30.0.2" puts the tenth address first, and the pool would fill in an
      // order no operator would choose.
      const free = await tx.ipAllocation.findFirst({
        where: {
          status: "Free",
          ...(opts.poolId ? { poolId: opts.poolId } : {}),
        },
        orderBy: { sortKey: "asc" },
        select: { id: true, ip: true },
      });
      if (!free) {
        return {
          ok: false,
          error: opts.poolId
            ? "That pool has no free addresses left."
            : "There are no free addresses left in any pool.",
        } as const;
      }
      allocation = free;
    }

    try {
      // **The old address is released before the new one is claimed**, and the
      // order is not cosmetic. `IpAllocation.customerId` is unique, so claiming a
      // second address while the first still points at this customer is refused by
      // the index — and the failure looks like a collision with a stranger when it
      // is the customer colliding with themselves.
      const previous = await releaseCustomerAllocations(tx, customerId, allocation.ip);


      // **A compare-and-swap, not a plain update.** Several auto-assigns running
      // at once can all read the same lowest-free row, and an unconditional
      // `update` lets all of them succeed in turn — the last writer wins, three
      // transactions believe they own the address, and three customers are told
      // they have the same IP. No unique violation is raised, because there is
      // nothing to violate: one row is being written four times.
      //
      // `updateMany` with the row's current owner in the `where` is the statement
      // the database makes atomic, so exactly one caller sees count 1.
      const claimed = await tx.ipAllocation.updateMany({
        where: { id: allocation.id, customerId: null, status: "Free" },
        data: { customerId, status: "Allocated", note: null },
      });
      if (claimed.count === 0) {
        // Somebody took it between the read and here. Put the customer's own
        // address back, because they still hold it — a loser in a race must not
        // end up with no address at all.
        if (previous) {
          await tx.ipAllocation.updateMany({
            where: { ip: previous, customerId: null },
            data: { customerId, status: "Allocated", note: null },
          });
          await tx.customer.update({
            where: { id: customerId },
            data: { ipAddress: previous },
          });
        }

        return {
          ok: false,
          error: `${allocation.ip} was allocated to somebody else a moment ago. Pick another.`,
        } as const;
      }

      await tx.customer.update({
        where: { id: customerId },
        data: { ipAddress: allocation.ip },
      });

      return {
        ok: true,
        ip: allocation.ip,
        allocationId: allocation.id,
        releasedPrevious: previous,
      } as const;
    } catch (e) {
      if (isUniqueViolation(e)) {
        return {
          ok: false,
          error: `${allocation.ip} was allocated to somebody else a moment ago. Pick another.`,
        } as const;
      }
      throw e;
    }
  });
}

/**
 * Returns a customer's addresses to Free, except `exceptIp`.
 *
 * Called when a customer disconnects, is deleted, or changes address. Without it
 * the pool fills with addresses that belong to customers who no longer hold them,
 * and the utilisation figure stops meaning anything.
 */
async function releaseCustomerAllocations(
  tx: Tx,
  customerId: string,
  exceptIp?: string | null
): Promise<string | null> {
  const held = await tx.ipAllocation.findMany({
    where: { customerId, ...(exceptIp ? { NOT: { ip: exceptIp } } : {}) },
    select: { ip: true },
  });
  if (!held.length) return null;

  await tx.ipAllocation.updateMany({
    where: { customerId, ...(exceptIp ? { NOT: { ip: exceptIp } } : {}) },
    data: { customerId: null, status: "Free" },
  });
  return held[0].ip;
}

/**
 * Frees a customer's address. The `exceptIp` escape is so a customer who is being
 * *re*assigned does not briefly free the address it is moving to.
 */
export async function release(customerId: string, exceptIp?: string | null): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const held = await tx.ipAllocation.findMany({
      where: { customerId, ...(exceptIp ? { NOT: { ip: exceptIp } } : {}) },
      select: { ip: true },
    });
    if (!held.length) return [];
    await tx.ipAllocation.updateMany({
      where: { customerId, ...(exceptIp ? { NOT: { ip: exceptIp } } : {}) },
      data: { customerId: null, status: "Free" },
    });
    // The customer's own column goes with it, so nothing reads an address the
    // pool believes is free. Guarded on the address actually being one of the
    // released ones, so releasing does not clear a newer address the customer was
    // given in the meantime.
    await tx.customer.updateMany({
      where: { id: customerId, ipAddress: { in: held.map((h) => h.ip) } },
      data: { ipAddress: null },
    });
    return held.map((h) => h.ip);
  });
}

/**
 * Holds an address for infrastructure — a gateway, a planned customer, a router's
 * management interface.
 *
 * `Reserved` rather than `Allocated`, so utilisation counts handed-out addresses
 * and not addresses the ISP has merely kept.
 */
export async function reserve(ip: string, note?: string | null) {
  try {
    return await prisma.ipAllocation.update({
      where: { ip: ip.trim() },
      data: { status: "Reserved", note: note ?? null },
      select: { id: true, ip: true },
    });
  } catch (e) {
    // P2025, "record not found", is what an address in no pool produces. The
    // operator is told that rather than being shown a Prisma error about a row
    // they have never heard of.
    if (isNotFound(e) || isUniqueViolation(e)) {
      throw new Error(`${ip} is not in any pool, so it cannot be reserved.`);
    }
    throw e;
  }
}

/**
 * Adopts an address a customer already holds from the free-text era.
 *
 * An explicit action rather than something the migration does, because only an
 * operator can say whether "10.10.10.7" on a customer is inside the new /24 or a
 * stale note from a decommissioned range. Adoption refuses if the address is
 * outside every pool or already spoken for.
 */
export async function adoptExisting(customerId: string): Promise<AllocateResult> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { ipAddress: true },
  });
  const ip = customer.ipAddress?.trim();
  if (!ip || parseIpv4(ip) === null) {
    return { ok: false, error: "That customer has no usable IP address on file." };
  }
  return allocate(customerId, { ip });
}

/**
 * Frees a customer's address inside a caller's transaction.
 *
 * Exported so disconnect and delete can release in the same transaction as their
 * own write, rather than opening a second one afterwards: between the two the
 * customer row and the allocation row disagree, and that window is exactly when an
 * operator sees an address as free while it is still on a customer's line.
 */
export async function releasePoolAddress(
  tx: Tx,
  customerId: string,
  reason: string
): Promise<string[]> {
  const held = await tx.ipAllocation.findMany({
    where: { customerId },
    select: { ip: true },
  });
  if (!held.length) return [];

  await tx.ipAllocation.updateMany({
    where: { customerId },
    data: { customerId: null, status: "Free", note: `Released: ${reason}` },
  });
  return held.map((h) => h.ip);
}

function isNotFound(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2025";
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2002" || /unique constraint/i.test(msg);
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Pools with their utilisation, for the Network → IP Pools page. */
export async function listPools() {
  const pools = await prisma.ipPool.findMany({
    orderBy: { name: "asc" },
    include: {
      router: { select: { name: true } },
      area: { select: { name: true } },
      _count: { select: { allocations: true } },
    },
  });

  const grouped = await prisma.ipAllocation.groupBy({
    by: ["poolId", "status"],
    _count: { _all: true },
  });

  const rows = pools.map((p) => {
    const counts = {
      Free: 0,
      Reserved: 0,
      Allocated: 0,
    };
    for (const g of grouped) if (g.poolId === p.id) counts[g.status as IpStatus] = g._count._all;

    const total = counts.Free + counts.Reserved + counts.Allocated;
    // Computed from the rows rather than from a stored figure, so it cannot
    // disagree with the table it describes.
    const inUse = counts.Allocated + counts.Reserved;
    return {
      ...p,
      counts,
      total,
      inUse,
      utilization: total === 0 ? 0 : Math.round((counts.Allocated / total) * 1000) / 10,
      freeCount: counts.Free,
    };
  });

  const totalCapacity = rows.reduce((s, r) => s + r.total, 0);
  const totalUsed = rows.reduce((s, r) => s + r.counts.Allocated, 0);

  return {
    rows,
    metrics: {
      pools: rows.length,
      totalCapacity,
      totalUsed,
      totalFree: rows.reduce((s, r) => s + r.freeCount, 0),
      utilization: totalCapacity === 0 ? 0 : Math.round((totalUsed / totalCapacity) * 1000) / 10,
    },
  };
}

/** Allocations in a pool, filterable, for the table under the utilisation bars. */
export async function listAllocations(
  p: { poolId?: string; status?: string; q?: string; take?: number } = {}
) {
  const where: Record<string, unknown> = {};
  if (p.poolId) where.poolId = p.poolId;
  if (p.status) where.status = p.status;
  if (p.q?.trim()) where.ip = { contains: p.q.trim() };

  return prisma.ipAllocation.findMany({
    where,
    orderBy: { sortKey: "asc" },
    take: p.take ?? 500,
    select: {
      id: true,
      ip: true,
      status: true,
      note: true,
      poolId: true,
      pool: { select: { name: true, cidr: true } },
      customer: { select: { id: true, name: true, customerCode: true } },
    },
  });
}

/** Addresses a customer could pick from — free ones in a pool, or everywhere. */
export async function freeAddresses(poolId?: string | null, take = 200) {
  return prisma.ipAllocation.findMany({
    where: { status: "Free", ...(poolId ? { poolId } : {}) },
    orderBy: { sortKey: "asc" },
    take,
    select: { id: true, ip: true, poolId: true, pool: { select: { name: true } } },
  });
}

/** What a pool can hold, without creating it. Used by the form's hint text. */
export function describeCidr(cidr: string, gateway?: string | null) {
  const parsed = parseCidr(cidr);
  if (!parsed) return null;
  const allocatable = allocatableAddresses(parsed, gateway);
  return {
    network: formatIpv4(parsed.network),
    prefix: parsed.prefix,
    total: parsed.size,
    usable: parsed.usable.length,
    allocatable: allocatable.length,
  };
}