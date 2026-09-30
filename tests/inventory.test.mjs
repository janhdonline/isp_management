/**
 * Stock.
 *
 * These checks are all about the one property that makes an inventory worth
 * having: the balance on an item is always the sum of its movements, and stock
 * can never go negative. A stock level that drifts is worse than no inventory at
 * all, because an ISP will provision a customer with a device it does not have.
 *
 * Every assertion reads the database back rather than trusting the value the
 * function returned, and the ledger reconciliation runs over every item at the
 * end so a bug that only shows up on some rows cannot pass.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import {
  createItem,
  updateItem,
  recordMovement,
  listItems,
  getItemDetail,
  reconcileStock,
  assignEquipment,
  returnEquipment,
  deleteItem,
} from "../src/lib/services/inventory.ts";

let sku;
let itemId;
let adminId;
let customerId;
let createdItemIds = [];
let createdCustomerIds = [];

const newSku = (n) => `TEST-${n}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function cleanup() {
  if (itemId) {
    await prisma.customerEquipment.deleteMany({ where: { itemId } });
    await prisma.stockMovement.deleteMany({ where: { itemId } });
    await prisma.inventoryItem.deleteMany({ where: { id: itemId } });
  }
  if (createdItemIds.length) {
    await prisma.customerEquipment.deleteMany({ where: { itemId: { in: createdItemIds } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: createdItemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: createdItemIds } } });
  }
  if (createdCustomerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  }
}

before(async () => {
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@isp.com" } })).id;
  customerId = (await prisma.customer.findFirstOrThrow({ select: { id: true } })).id;
  await cleanup();
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("stock movements", () => {
  test("a new item starts at zero and is not low stock by accident", async () => {
    sku = newSku("ONU");
    const item = await createItem({
      name: "Test ONU GPON",
      sku,
      category: "ONU",
      reorderLevel: 0,
      unitPrice: 2500,
      userId: adminId,
    });
    itemId = item.id;

    assert.equal(item.quantity, 0);
    assert.equal(item.sku, sku.toUpperCase(), "SKUs are normalised so they cannot drift by case");
    assert.equal(item.lowStock, false, "with a reorder level of zero, empty is not 'low' by accident");
    assert.equal(item.value, 0);
  });

  test("a duplicate SKU is refused with a message that names the clash", async () => {
    await assert.rejects(
      () => createItem({ name: "Another", sku, category: "ONU", userId: adminId }),
      /already used by "Test ONU GPON"/
    );
  });

  test("stock in raises the balance and writes one movement", async () => {
    const r = await recordMovement({ itemId, type: "IN", quantity: 10, userId: adminId });
    assert.equal(r.item.quantity, 10);
    assert.ok(r.movement, "a movement row must be written");

    const fromDb = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(fromDb.quantity, 10, "read the balance back, do not trust the return value");

    const movements = await prisma.stockMovement.count({ where: { itemId } });
    assert.equal(movements, 1);
  });

  test("stock out lowers the balance and is recorded as negative", async () => {
    const r = await recordMovement({
      itemId,
      type: "OUT",
      quantity: 3,
      note: "Issued to a new customer",
      userId: adminId,
    });
    assert.equal(r.item.quantity, 7);

    const row = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(row.quantity, -3, "the ledger stores the signed delta, not the absolute figure");
  });

  test("stock cannot go negative", async () => {
    await assert.rejects(
      () => recordMovement({ itemId, type: "OUT", quantity: 8, userId: adminId }),
      /Only 7 pcs of .* are in stock/
    );

    const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(after.quantity, 7, "a refused issue must not change the balance");

    // And no movement row for the refused attempt.
    const count = await prisma.stockMovement.count({ where: { itemId, type: "OUT" } });
    assert.equal(count, 1, "only the successful issue is on the ledger");
  });

  test("a count that agrees with the books records nothing", async () => {
    const r = await recordMovement({ itemId, type: "ADJUST", quantity: 7, userId: adminId });
    assert.equal(r.noChange, true, "a count matching the stock is not a movement");
    assert.equal(r.movement, null);

    const count = await prisma.stockMovement.count({ where: { itemId, type: "ADJUST" } });
    assert.equal(count, 0, "no row of zeroes on the ledger");
  });

  test("a count that finds a difference records the delta, not the count", async () => {
    const r = await recordMovement({ itemId, type: "ADJUST", quantity: 5, userId: adminId });
    assert.equal(r.item.quantity, 5);
    assert.equal(r.movement.quantity, -2, "the ledger holds the difference, not the counted total");

    const row = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId, type: "ADJUST" },
    });
    assert.equal(row.quantity, -2);
  });

  test("a negative count is refused rather than stored", async () => {
    await assert.rejects(
      () => recordMovement({ itemId, type: "ADJUST", quantity: -3, userId: adminId }),
      /cannot be negative/
    );
  });

  test("a zero movement is refused", async () => {
    await assert.rejects(
      () => recordMovement({ itemId, type: "IN", quantity: 0, userId: adminId }),
      /other than zero/
    );
  });

  test("raising the reorder level flags low stock without moving the balance", async () => {
    const updated = await updateItem({ id: itemId, reorderLevel: 10, userId: adminId });
    assert.equal(updated.reorderLevel, 10);
    assert.equal(updated.quantity, 5, "a reorder level is not a stock movement");
    assert.equal(updated.lowStock, true, "5 is at or below a reorder level of 10");

    const fromDb = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    assert.equal(fromDb.quantity, 5);
  });

  test("the low-stock filter returns short items, not merely empty ones", async () => {
    // This is the distinction a wrong query gets wrong: `quantity <= 0` would
    // return only the empties and hide the item that merely needs reordering.
    const { rows } = await listItems({ lowStockOnly: true });
    const mine = rows.find((r) => r.id === itemId);
    assert.ok(mine, "an item below its reorder level belongs on the short list");
    assert.equal(mine.lowStock, true);
    assert.ok(mine.quantity > 0, "it is short, not empty");
  });

  test("the list reports stock value from quantity and unit price", async () => {
    const { rows } = await listItems({ q: sku });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 5 * 2500);
  });
});

/* ------------------------------------------------------------------ */

describe("customer equipment", () => {
  test("assigning a unit decrements stock and records the serial", async () => {
    // Give the item a reorder level it is not short of, so the assign is clean.
    await updateItem({ id: itemId, reorderLevel: 2, userId: adminId });

    const serial = `SN-${Date.now()}`;
    const { equipment, item } = await assignEquipment({
      customerId,
      itemId,
      serial,
      mac: "AA:BB:CC:DD:EE:FF",
      userId: adminId,
    });

    assert.equal(equipment.serial, serial.toUpperCase());
    assert.equal(item.quantity, 4, "the unit left the shelf in the same transaction");

    const eq = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } });
    assert.equal(eq.status, "Assigned");
    assert.ok(eq.assignedAt);
  });

  test("the same serial cannot be issued twice", async () => {
    const serial = `DUP-${Date.now()}`;
    await assignEquipment({ customerId, itemId, serial, userId: adminId });

    // To a different customer — the case that matters, since one ONU recorded in
    // two houses makes a swap a fortnight of argument.
    const other = await prisma.customer.create({
      data: {
        customerCode: `TEST-EQ-${Date.now()}`,
        name: "Equipment Test",
        username: `eqtest${Date.now()}`,
        phone: "01700000000",
        password: "x",
        connectionStatus: "Active",
      },
      select: { id: true },
    });
    createdCustomerIds.push(other.id);

    await assert.rejects(
      () => assignEquipment({ customerId: other.id, itemId, serial, userId: adminId }),
      /already recorded to another customer/
    );

    const eq = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } });
    assert.equal(eq.customerId, customerId, "the first assignment stands");
  });

  test("a working device comes back onto the shelf", async () => {
    const serial = `RET-${Date.now()}`;
    await assignEquipment({ customerId, itemId, serial, userId: adminId });
    const afterIssue = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).quantity;

    const { item } = await returnEquipment({
      equipmentId: (await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } })).id,
      status: "Returned",
      note: "Customer moved house, kept the ONU",
      userId: adminId,
    });

    assert.equal(item.quantity, afterIssue + 1);
    const eq = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } });
    assert.equal(eq.status, "Returned");
    assert.ok(eq.returnedAt);
  });

  test("a faulty device is written off, not quietly returned to the shelf", async () => {
    const serial = `BAD-${Date.now()}`;
    await assignEquipment({ customerId, itemId, serial, userId: adminId });
    const afterIssue = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).quantity;

    const { item } = await returnEquipment({
      equipmentId: (await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } })).id,
      status: "Faulty",
      note: "No light after a power cut",
      userId: adminId,
    });

    assert.equal(item.quantity, afterIssue, "a dead ONU must not reappear as usable stock");
    const eq = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } });
    assert.equal(eq.status, "Faulty");

    // But the write-off is on the ledger, so the drop is explained.
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { itemId, reference: serial },
      orderBy: { createdAt: "desc" },
    });
    assert.match(movement.note, /Written off as faulty/);
  });

  test("the same device cannot be returned twice", async () => {
    const serial = `TWICE-${Date.now()}`;
    await assignEquipment({ customerId, itemId, serial, userId: adminId });
    const eq = await prisma.customerEquipment.findUniqueOrThrow({ where: { serial } });

    await returnEquipment({ equipmentId: eq.id, status: "Returned", userId: adminId });
    await assert.rejects(
      () => returnEquipment({ equipmentId: eq.id, status: "Returned", userId: adminId }),
      /already recorded as returned/
    );
  });
});

/* ------------------------------------------------------------------ */

describe("safety rules", () => {
  test("an item with stock cannot be deleted", async () => {
    await assert.rejects(() => deleteItem(itemId, adminId), /still shows \d+ in stock/);
  });

  test("an item that is out to a customer cannot be deleted even at zero stock", async () => {
    const s2 = newSku("OUT");
    const item = await createItem({ name: "Zero Stock", sku: s2, category: "Cable", userId: adminId });
    createdItemIds.push(item.id);

    // Receive two, issue one as a device and one as loose stock, so the item
    // ends at zero with a customer still holding a unit.
    const serial = `HELD-${Date.now()}`;
    await recordMovement({ itemId: item.id, type: "IN", quantity: 2, userId: adminId });
    await assignEquipment({ customerId, itemId: item.id, serial, userId: adminId });
    await recordMovement({ itemId: item.id, type: "OUT", quantity: 1, userId: adminId });

    const balance = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity;
    assert.equal(balance, 0, "both units are out of the shelf");

    await assert.rejects(
      () => deleteItem(item.id, adminId),
      /recorded against 1 customer/,
      "deleting the item would orphan a device that is in someone's house"
    );
  });

  test("an unused, empty item can be deleted", async () => {
    const s3 = newSku("TMP");
    const item = await createItem({ name: "Scratch", sku: s3, category: "Other", userId: adminId });
    assert.equal(await deleteItem(item.id, adminId), true);
    assert.equal(await prisma.inventoryItem.findUnique({ where: { id: item.id } }), null);
  });

  test("assigning from an empty shelf is refused with the reorder level mentioned", async () => {
    const s4 = newSku("EMPTY");
    const item = await createItem({
      name: "Nothing Here",
      sku: s4,
      category: "ONU",
      reorderLevel: 4,
      userId: adminId,
    });
    createdItemIds.push(item.id);

    await assert.rejects(
      () => assignEquipment({ customerId, itemId: item.id, serial: `NO-${Date.now()}`, userId: adminId }),
      /No .* are in stock.*reorder level of 4 has been reached/
    );
  });

  test("every item's balance equals the sum of its movements", async () => {
    // The whole point of the module, checked across the table rather than on the
    // one item the other tests happened to use.
    const drift = await reconcileStock();
    assert.deepEqual(
      drift,
      [],
      `stock balances disagree with the ledger: ${JSON.stringify(drift, null, 2)}`
    );
  });

  test("the detail view shows movements and assigned devices", async () => {
    const detail = await getItemDetail(itemId);
    assert.ok(detail, "the item should load");
    assert.ok(detail.movements.length >= 5, "the history is the audit trail");
    assert.ok(detail.assigned.length >= 1, "devices out are visible on the item");
    assert.equal(detail.item.sku, sku.toUpperCase());
  });
});
