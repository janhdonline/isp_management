import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import {
  createPool,
  allocate,
  release,
  reserve,
  adoptExisting,
  listPools,
  listAllocations,
  describeCidr,
} from "../src/lib/services/ipam.ts";
import { parseCidr, parseIpv4, allocatableAddresses, formatIpv4 } from "../src/lib/services/cidr.ts";

const stamp = Date.now();
const poolIds = [];
const customerIds = [];

let seq = 0;

async function makeCustomer(over = {}) {
  // A counter rather than the array length, because the concurrency cases create
  // several at once and the length is the same for all of them.
  seq += 1;
  const n = seq;
  const c = await prisma.customer.create({
    data: {
      customerCode: `IPAM-${stamp}-${n}`,
      name: `IPAM Test ${n}`,
      username: `ipam${stamp}${n}`,
      phone: `015${String(10000000 + n)}`,
      connectionStatus: "Active",
      connectionDate: new Date(),
      ...over,
    },
    select: { id: true },
  });
  customerIds.push(c.id);
  return c;
}

async function makePool(cidr, extra = {}) {
  const r = await createPool({ name: `IPAM Pool ${poolIds.length + 1} ${stamp}`, cidr, ...extra });
  poolIds.push(r.poolId);
  return r;
}

before(() => {
  assert.ok(true);
});

beforeEach(async () => {
  if (customerIds.length) {
    await prisma.ipAllocation.deleteMany({ where: { customerId: { in: customerIds } } });
  }
});

after(async () => {
  if (poolIds.length) await prisma.ipPool.deleteMany({ where: { id: { in: poolIds } } });
  if (customerIds.length) {
    await prisma.ipAllocation.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("CIDR arithmetic", () => {
  test("a /24 has 256 addresses, 254 usable, and 253 with a gateway", () => {
    const p = parseCidr("10.10.10.0/24");
    assert.equal(p.size, 256);
    assert.equal(p.usable.length, 254, "network and broadcast are not hosts");
    assert.equal(p.usable[0], "10.10.10.1");
    assert.equal(p.usable.at(-1), "10.10.10.254");
    assert.equal(allocatableAddresses(p, "10.10.10.1").length, 253);
  });

  test("a /30 has exactly one usable address once the gateway is taken", () => {
    // RFC 3021 aside, a /30 is the smallest traditional subnet: four addresses,
    // of which two are network and broadcast, leaving two hosts. One of those is
    // the gateway, so one remains.
    const p = parseCidr("10.0.0.4/30");
    assert.equal(p.size, 4);
    assert.equal(p.usable.length, 2, "10.0.0.5 and 10.0.0.6");
    assert.deepEqual(p.usable, ["10.0.0.5", "10.0.0.6"]);
    assert.deepEqual(allocatableAddresses(p, "10.0.0.5"), ["10.0.0.6"]);
    assert.deepEqual(allocatableAddresses(p, "10.0.0.6"), ["10.0.0.5"]);
    // With no gateway the /30 has two, and the two are symmetric.
    assert.equal(allocatableAddresses(p, null).length, 2);
  });

  test("/31 and /32 have no network or broadcast", () => {
    // RFC 3021: a point-to-point link uses both addresses. Excluding the first and
    // last of a /31 would leave a subnet that cannot route.
    const p31 = parseCidr("10.0.0.0/31");
    assert.equal(p31.usable.length, 2);
    assert.deepEqual(p31.usable, ["10.0.0.0", "10.0.0.1"]);

    const p32 = parseCidr("10.0.0.5/32");
    assert.equal(p32.size, 1);
    assert.deepEqual(p32.usable, ["10.0.0.5"]);
  });

  test("a CIDR with host bits set is canonicalised, not rejected", () => {
    // "10.0.5.3/24" and "10.0.5.0/24" describe the same subnet; storing both as
    // pools would be two names for one range and a double-allocation waiting to
    // happen.
    const p = parseCidr("10.0.5.3/24");
    assert.equal(formatIpv4(p.network), "10.0.5.0");
    assert.equal(p.size, 256);
  });

  test("rubbish does not parse", () => {
    for (const bad of ["", "not-a-cidr", "10.0.0.0", "10.0.0.0/33", "10.0.0.0/-1", "256.0.0.0/24", "10.0.0/24"]) {
      assert.equal(parseCidr(bad), null, `${bad} must not parse`);
    }
    for (const bad of ["010.0.0.1", "10.0.0.256", "", "10.0.0"]) {
      assert.equal(parseIpv4(bad), null, `${bad} must not be an address`);
    }
  });

  test("describeCidr previews a pool without creating it", () => {
    const d = describeCidr("10.10.20.0/24", "10.10.20.1");
    assert.equal(d.network, "10.10.20.0");
    assert.equal(d.total, 256);
    assert.equal(d.allocatable, 253);
  });
});

/* ------------------------------------------------------------------ */

describe("creating a pool", () => {
  test("a /24 produces 253 free rows, gateway excluded", async () => {
    const { poolId, total } = await makePool("10.20.30.0/24", { gateway: "10.20.30.1" });

    assert.equal(total, 253);
    const rows = await prisma.ipAllocation.findMany({ where: { poolId } });
    assert.equal(rows.length, 253, "253 usable Free rows");
    assert.ok(rows.every((r) => r.status === "Free"), "all start Free");

    const ips = rows.map((r) => r.ip);
    assert.ok(!ips.includes("10.20.30.0"), "the network address is not handed out");
    assert.ok(!ips.includes("10.20.30.255"), "nor the broadcast");
    assert.ok(!ips.includes("10.20.30.1"), "nor the gateway — a router cannot route its own address");
    assert.ok(ips.includes("10.20.30.2") && ips.includes("10.20.30.254"));
  });

  test("a /30 produces one row", async () => {
    const { poolId, total } = await makePool("10.20.40.4/30", { gateway: "10.20.40.5" });
    assert.equal(total, 1);
    const rows = await prisma.ipAllocation.findMany({ where: { poolId } });
    assert.deepEqual(rows.map((r) => r.ip), ["10.20.40.6"]);
  });

  test("an invalid CIDR is refused and creates nothing", async () => {
    await assert.rejects(
      createPool({ name: `bad ${Date.now()}`, cidr: "not-a-cidr" }),
      /not a valid IPv4 CIDR/
    );
  });

  test("a gateway outside the pool is refused", async () => {
    // A pool whose gateway is elsewhere cannot route, and creating 253 rows for it
    // would look like success.
    await assert.rejects(
      createPool({ name: `badgw ${Date.now()}`, cidr: "10.20.50.0/24", gateway: "192.168.1.1" }),
      /outside/
    );
  });

  test("the stored CIDR is canonical", async () => {
    const { poolId } = await makePool("10.20.60.7/24");
    const pool = await prisma.ipPool.findUniqueOrThrow({ where: { id: poolId } });
    assert.equal(pool.cidr, "10.20.60.0/24");
  });
});

/* ------------------------------------------------------------------ */

describe("allocation", () => {
  test("an auto-assign takes the lowest free address and sets it on the customer", async () => {
    const { poolId } = await makePool("10.30.0.0/24", { gateway: "10.30.0.1" });
    const c = await makeCustomer();

    const r = await allocate(c.id, { poolId });
    assert.equal(r.ok, true);
    // Sorted order, so "next free" is the same address every time rather than
    // whatever the planner happens to return.
    assert.equal(r.ok && r.ip, "10.30.0.2");

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(customer.ipAddress, "10.30.0.2", "the allocation and the customer column are one fact");

    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip: "10.30.0.2" } });
    assert.equal(row.status, "Allocated");
    assert.equal(row.customerId, c.id);
  });

  test("a manual pick inside the pool works", async () => {
    const { poolId } = await makePool("10.31.0.0/24", { gateway: "10.31.0.1" });
    const c = await makeCustomer();
    const r = await allocate(c.id, { ip: "10.31.0.99", poolId });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.ip, "10.31.0.99");
  });

  test("an address outside every pool is refused", async () => {
    const c = await makeCustomer();
    const r = await allocate(c.id, { ip: "203.0.113.7" });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : "", /not in any pool/);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(customer.ipAddress, null, "no partial write");
  });

  test("a second customer cannot take an address that is taken", async () => {
    const { poolId } = await makePool("10.32.0.0/24", { gateway: "10.32.0.1" });
    const a = await makeCustomer();
    const b = await makeCustomer();

    const first = await allocate(a.id, { poolId });
    assert.equal(first.ok, true);
    const second = await allocate(b.id, { ip: first.ok ? first.ip : "", poolId });

    assert.equal(second.ok, false);
    assert.match(second.ok === false ? second.error : "", /already allocated/);

    const stillA = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip: first.ok ? first.ip : "" } });
    assert.equal(stillA.customerId, a.id, "the original holder keeps it");
  });

  test("two concurrent allocations of the same address: one wins, no partial write", async () => {
    // The check-then-allocate gap. Both callers read "free", both write, and the
    // unique index is the only thing that makes exactly one succeed.
    const { poolId } = await makePool("10.33.0.0/24", { gateway: "10.33.0.1" });
    const a = await makeCustomer();
    const b = await makeCustomer();
    const ip = "10.33.0.50";

    const results = await Promise.all([
      allocate(a.id, { ip, poolId }),
      allocate(b.id, { ip, poolId }),
    ]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, "exactly one allocation succeeds");
    assert.equal(losers.length, 1);
    assert.match(losers[0].ok === false ? losers[0].error : "", /allocated to somebody else|already allocated/);

    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip } });
    assert.ok(row.customerId === a.id || row.customerId === b.id, "and the row names exactly one of them");
    const loser = row.customerId === a.id ? b.id : a.id;
    const loserCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: loser } });
    assert.equal(loserCustomer.ipAddress, null, "the loser has no address written");
  });

  test("four concurrent auto-assigns to one pool never collide", async () => {
    const { poolId } = await makePool("10.34.0.0/24", { gateway: "10.34.0.1" });
    const customers = await Promise.all([1, 2, 3, 4].map(() => makeCustomer()));

    const results = await Promise.all(customers.map((c) => allocate(c.id, { poolId })));
    const ips = results.filter((r) => r.ok).map((r) => r.ip);

    assert.equal(new Set(ips).size, ips.length, "no two customers got the same address");
    assert.equal(ips.length, 4);
    for (const ip of ips) {
      const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip } });
      assert.equal(row.status, "Allocated");
    }
  });

  test("one customer holds one address; changing it frees the old one", async () => {
    const { poolId } = await makePool("10.35.0.0/24", { gateway: "10.35.0.1" });
    const c = await makeCustomer();

    const first = await allocate(c.id, { poolId });
    assert.equal(first.ok, true);
    const firstIp = first.ok ? first.ip : "";

    // Auto-assign now skips the one it holds and takes the next.
    const second = await allocate(c.id, { poolId });
    assert.equal(second.ok && second.ip, "10.35.0.3");
    assert.equal(second.ok && second.releasedPrevious, firstIp, "the old address goes back to the pool");

    const oldRow = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip: firstIp } });
    assert.equal(oldRow.status, "Free", "and it is reusable");
    assert.equal(oldRow.customerId, null);

    const held = await prisma.ipAllocation.findMany({ where: { customerId: c.id } });
    assert.equal(held.length, 1, "a customer holds exactly one address");
  });
});

/* ------------------------------------------------------------------ */

describe("release", () => {
  test("a released address is Free and can be re-assigned", async () => {
    const { poolId } = await makePool("10.36.0.0/24", { gateway: "10.36.0.1" });
    const a = await makeCustomer();
    const b = await makeCustomer();

    const first = await allocate(a.id, { poolId });
    const ip = first.ok ? first.ip : "";
    assert.ok(ip);

    const freed = await release(a.id);
    assert.deepEqual(freed, [ip]);

    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip } });
    assert.equal(row.status, "Free");
    assert.equal(row.customerId, null);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(customer.ipAddress, null, "and the customer column goes with it");

    const again = await allocate(b.id, { ip });
    assert.equal(again.ok, true, "the same address is handable again");
  });

  test("disconnecting a customer releases the address", async () => {
    const { disconnectCustomer } = await import("../src/lib/services/customers.ts");
    const { poolId } = await makePool("10.37.0.0/24", { gateway: "10.37.0.1" });
    const c = await makeCustomer();
    const r = await allocate(c.id, { poolId });
    const ip = r.ok ? r.ip : "";

    await prisma.$transaction((tx) => disconnectCustomer(tx, c.id, "Test"));

    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip } });
    assert.equal(row.status, "Free", "a disconnected customer is not holding the address");
    assert.match(row.note ?? "", /Disconnected/);
  });

  test("deleting a customer releases the address", async () => {
    const { deleteCustomer } = await import("../src/lib/services/customers.ts");
    const { poolId } = await makePool("10.38.0.0/24", { gateway: "10.38.0.1" });
    const c = await makeCustomer();
    const r = await allocate(c.id, { poolId });
    assert.ok(r.ok, `could not allocate: ${r.ok === false ? r.error : ""}`);
    const ip = r.ip;
    const id = c.id;
    customerIds.splice(customerIds.indexOf(id), 1);

    await deleteCustomer(id);

    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip } });
    assert.equal(row.status, "Free", "a deleted customer must not leave the address stuck");
    assert.equal(row.customerId, null, "no stale Allocated row pointing at nobody");
  });
});

/* ------------------------------------------------------------------ */

describe("reserved addresses", () => {
  test("a reserved address is not handed out and does not count as allocated", async () => {
    const { poolId } = await makePool("10.39.0.0/24", { gateway: "10.39.0.1" });
    const r = await reserve("10.39.0.10", "Planned for the branch office");
    assert.equal(r.ip, "10.39.0.10");

    const c = await makeCustomer();
    const got = await allocate(c.id, { poolId });
    assert.equal(got.ok && got.ip, "10.39.0.2", "auto-assign skips the reservation");
  });

  test("an address outside every pool cannot be reserved", async () => {
    await assert.rejects(reserve("198.51.100.1", "nope"), /not in any pool/);
  });
});

/* ------------------------------------------------------------------ */

describe("adopting an address the customer already had", () => {
  test("an address inside a pool is adopted", async () => {
    await makePool("10.40.0.0/24", { gateway: "10.40.0.1" });
    const c = await makeCustomer({ ipAddress: "10.40.0.77" });

    const r = await adoptExisting(c.id);
    assert.equal(r.ok, true);
    const row = await prisma.ipAllocation.findUniqueOrThrow({ where: { ip: "10.40.0.77" } });
    assert.equal(row.status, "Allocated");
    assert.equal(row.customerId, c.id);
  });

  test("an address outside every pool is left alone and reported", async () => {
    await makePool("10.41.0.0/24", { gateway: "10.41.0.1" });
    const c = await makeCustomer({ ipAddress: "192.0.2.55" });

    const r = await adoptExisting(c.id);
    assert.equal(r.ok, false);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(customer.ipAddress, "192.0.2.55", "the free-text value is not clobbered");
  });

  test("a customer with no address is reported rather than crashing", async () => {
    const c = await makeCustomer();
    const r = await adoptExisting(c.id);
    assert.equal(r.ok, false);
  });
});

/* ------------------------------------------------------------------ */

describe("utilisation", () => {
  test("the percentage is exactly allocated over total", async () => {
    const { poolId, total } = await makePool("10.42.0.0/24", { gateway: "10.42.0.1" });
    for (let i = 0; i < 10; i++) await allocate((await makeCustomer()).id, { poolId });

    const { rows } = await listPools();
    const pool = rows.find((r) => r.id === poolId);
    assert.equal(pool.total, total);
    assert.equal(pool.counts.Allocated, 10);
    assert.equal(pool.counts.Free, 243);
    // 10/253 = 3.952569…%, kept to one decimal.
    assert.equal(pool.utilization, 4);
    assert.equal(
      Math.round((pool.counts.Allocated / pool.total) * 1000) / 10,
      pool.utilization,
      "computed from the rows, not a stored figure"
    );
  });

  test("reserved addresses are not counted as allocated", async () => {
    const { poolId } = await makePool("10.43.0.0/24", { gateway: "10.43.0.1" });
    await reserve("10.43.0.20");
    await reserve("10.43.0.21");

    const { rows } = await listPools();
    const pool = rows.find((r) => r.id === poolId);
    assert.equal(pool.counts.Reserved, 2);
    assert.equal(pool.counts.Allocated, 0);
    assert.equal(pool.utilization, 0, "held for infrastructure is not handed out");
    assert.equal(pool.freeCount, 251);
  });

  test("the totals across pools add up", async () => {
    const a = await makePool("10.44.0.0/24", { gateway: "10.44.0.1" });
    const b = await makePool("10.45.0.0/28", { gateway: "10.45.0.1" });
    await allocate((await makeCustomer()).id, { poolId: a.poolId });

    // Scoped to this test's two pools: `metrics` deliberately covers every pool in
    // the installation, which on a test database includes pools this file did not
    // create.
    const { rows, metrics } = await listPools();
    const ours = rows.filter((r) => r.id === a.poolId || r.id === b.poolId);
    const capacity = ours.reduce((s, r) => s + r.total, 0);
    assert.equal(capacity, 253 + 13, "a /28 leaves 14 usable, 13 after the gateway");
    assert.equal(ours.reduce((s, r) => s + r.counts.Allocated, 0), 1);

    // And the installation-wide figure is at least those two pools, not less.
    assert.ok(metrics.totalCapacity >= capacity);
    assert.ok(metrics.totalUsed >= 1);
  });

  test("the allocation table can be filtered by pool and searched", async () => {
    const { poolId } = await makePool("10.46.0.0/24", { gateway: "10.46.0.1" });
    const c = await makeCustomer();
    await allocate(c.id, { ip: "10.46.0.123", poolId });

    const byPool = await listAllocations({ poolId });
    assert.equal(byPool.length, 253);
    const allocated = await listAllocations({ poolId, status: "Allocated" });
    assert.equal(allocated.length, 1);
    assert.equal(allocated[0].customer?.id, c.id);

    const search = await listAllocations({ poolId, q: "10.46.0.123" });
    assert.equal(search.length, 1);
    const none = await listAllocations({ poolId, q: "10.46.0.999" });
    assert.equal(none.length, 0);
  });
});