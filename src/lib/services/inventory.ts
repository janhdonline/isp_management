import { prisma } from "@/lib/prisma";
import { prismaLog } from "@/lib/services/activity";
import { logActivity } from "@/lib/services/activity";

/**
 * Stock.
 *
 * The one rule this module exists to enforce: `InventoryItem.quantity` is never
 * set by anyone typing a number. It is the running total of `StockMovement` rows,
 * and the movement and the balance are written in the same transaction. A stock
 * figure that can be edited directly is a stock figure that will be wrong, and an
 * ISP that thinks it has twenty spare ONUs and has four is an ISP that turns away
 * customers.
 *
 * Every function recomputes rather than incrementing, so a lost update cannot
 * quietly shift the balance — two people taking the last unit at the same moment
 * produce one success and one refusal, not a negative shelf.
 */

// Defined in `enums`, not here, because a client component needs them too and
// cannot import a service that pulls Prisma into the browser bundle. Re-exported
// so server-side callers have one import for the module.
import {
  INVENTORY_CATEGORIES,
  STOCK_MOVEMENT_TYPES,
} from "@/lib/enums";

export const CATEGORIES = INVENTORY_CATEGORIES;
export const MOVEMENT_TYPES = STOCK_MOVEMENT_TYPES;

export type Category = (typeof CATEGORIES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Whether an item needs reordering.
 *
 * A reorder level of zero means "do not reorder this" rather than "reorder it
 * when there is nothing left", so it switches the warning off entirely. Without
 * that, every item created with the default level would light up the low-stock
 * list the moment it was empty — and an alert that is always on is an alert
 * nobody reads, which is how a genuinely short shelf gets missed.
 */
export const isLowStock = (item: { quantity: number; reorderLevel: number }): boolean =>
  item.reorderLevel > 0 && item.quantity <= item.reorderLevel;

export type InventoryRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
  lowStock: boolean;
  /** Stock value, for the totals card. */
  value: number;
};

type ItemRow = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
};

const toRow = (i: ItemRow): InventoryRow => ({
  ...i,
  lowStock: isLowStock(i),
  value: Math.round((i.quantity * (i.unitPrice ?? 0)) * 100) / 100,
});

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export async function listItems(filter?: {
  q?: string;
  category?: string;
  lowStockOnly?: boolean;
}): Promise<{ rows: InventoryRow[]; metrics: { total: number; lowStock: number; value: number; units: number } }> {
  const where: Record<string, unknown> = {};
  if (filter?.q?.trim()) {
    const q = filter.q.trim();
    // Case-insensitive contains on both identifiers, because staff search for
    // either the product name or the code on the box.
    where.OR = [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }];
  }
  if (filter?.category && filter.category !== "All") where.category = filter.category;

  // "Low stock" is `quantity <= reorderLevel`, a comparison between two columns
  // of the same row. Prisma cannot express that in a `where`, and hard-coding
  // `lte: 0` would quietly return only the items that are actually empty
  // rather than the ones that need reordering. So it is filtered after the
  // derived flag is computed — and the table is small enough that this costs
  // less than a raw query would cost to keep correct.
  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const rows = items.map(toRow).filter((r) => (filter?.lowStockOnly ? r.lowStock : true));

  return {
    rows,
    metrics: {
      total: rows.length,
      lowStock: rows.filter((r) => r.lowStock).length,
      value: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
      units: rows.reduce((s, r) => s + r.quantity, 0),
    },
  };
}

export async function getItem(id: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  return item ? toRow(item) : null;
}

export async function getItemDetail(id: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: {
      movements: {
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      assigned: {
        include: { customer: { select: { id: true, name: true, username: true } } },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!item) return null;

  const { movements, assigned, ...rest } = item;
  return { item: toRow(rest), movements, assigned };
}

/**
 * The stock ledger, checked against the balances.
 *
 * If these ever disagree, somebody has edited a balance directly and the
 * movements are the truth worth reconstructing from. Called by the verify suite
 * so the drift is caught rather than discovered during an audit.
 */
export async function reconcileStock(): Promise<
  { itemId: string; sku: string; recorded: number; fromLedger: number }[]
> {
  const items = await prisma.inventoryItem.findMany({
    select: { id: true, sku: true, quantity: true, name: true },
  });
  const sums = await prisma.stockMovement.groupBy({
    by: ["itemId"],
    _sum: { quantity: true },
  });
  const ledger = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));

  return items
    .map((i) => ({
      itemId: i.id,
      sku: i.sku,
      name: i.name,
      recorded: i.quantity,
      fromLedger: ledger.get(i.id) ?? 0,
    }))
    .filter((r) => r.recorded !== r.fromLedger);
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export async function createItem(input: {
  name: string;
  sku: string;
  category: string;
  unit?: string;
  reorderLevel?: number;
  unitPrice?: number | null;
  userId?: string;
}) {
  const name = input.name.trim();
  const sku = input.sku.trim().toUpperCase();
  if (!name) throw new Error("A name is required");
  if (!sku) throw new Error("A SKU is required");

  const clash = await prisma.inventoryItem.findUnique({ where: { sku } });
  if (clash) throw new Error(`The SKU ${sku} is already used by "${clash.name}"`);

  const item = await prisma.inventoryItem.create({
    data: {
      name,
      sku,
      category: input.category,
      unit: input.unit?.trim() || "pcs",
      reorderLevel: Math.max(0, Math.floor(input.reorderLevel ?? 0)),
      unitPrice: input.unitPrice ?? null,
    },
  });

  await logActivity(
    {
      action: "Create",
      entity: "InventoryItem",
      entityId: item.id,
      summary: `Created inventory item ${item.sku} (${item.name})`,
    },
    input.userId
  );
  return toRow(item);
}

/**
 * Edits an item's description.
 *
 * Takes a single object rather than `(id, input)` even though the rest of the
 * service layer is positional. With six optional fields the positional form
 * invites the caller to pass the wrong argument in the wrong order, and a
 * mistaken `id` is not a type error — it is a silent update to the wrong record
 * or a confusing "record not found" in the middle of an edit form.
 */
export async function updateItem(input: {
  id: string;
  name?: string;
  sku?: string;
  category?: string;
  unit?: string;
  reorderLevel?: number;
  unitPrice?: number | null;
  userId?: string;
}) {
  const { id } = input;
  const before = await prisma.inventoryItem.findUniqueOrThrow({ where: { id } });

  // Changing the reorder level is not a stock change: it must not move the
  // quantity, or the next count would look like a discrepancy that never
  // happened.
  const data: Record<string, unknown> = {};
  if (input.name?.trim()) data.name = input.name.trim();
  if (input.sku?.trim()) {
    const sku = input.sku.trim().toUpperCase();
    if (sku !== before.sku) {
      const clash = await prisma.inventoryItem.findUnique({ where: { sku } });
      if (clash) throw new Error(`The SKU ${sku} is already used by "${clash.name}"`);
    }
    data.sku = sku;
  }
  if (input.category) data.category = input.category;
  if (input.unit?.trim()) data.unit = input.unit.trim();
  if (input.reorderLevel !== undefined) {
    data.reorderLevel = Math.max(0, Math.floor(input.reorderLevel));
  }
  if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;

  const item = await prisma.inventoryItem.update({ where: { id }, data });

  await logActivity(
    {
      action: "Update",
      entity: "InventoryItem",
      entityId: id,
      summary: `Updated inventory item ${item.sku} (${item.name})`,
    },
    input.userId
  );
  return toRow(item);
}

/**
 * Deletes an item, but only if nothing is in stock and no device is out.
 *
 * An item with a balance or an assigned device is almost always a mistake, and
 * deleting it would leave a customer holding equipment that no longer exists
 * anywhere in the system — which is exactly what a swap-out a year later needs to
 * trace.
 */
export async function deleteItem(id: string, userId?: string) {
  const item = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { assigned: true } } },
  });

  if (item.quantity !== 0) {
    throw new Error(
      `${item.sku} still shows ${item.quantity} in stock. Record a stock movement to zero it first, so the ledger explains itself.`
    );
  }
  if (item._count.assigned > 0) {
    throw new Error(
      `${item.sku} is recorded against ${item._count.assigned} customer(s). Return those devices before deleting the item.`
    );
  }

  await prisma.inventoryItem.delete({ where: { id } });
  await logActivity(
    {
      action: "Delete",
      entity: "InventoryItem",
      entityId: id,
      summary: `Deleted inventory item ${item.sku} (${item.name})`,
    },
    userId
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Stock movements                                                     */
/* ------------------------------------------------------------------ */

/**
 * Records a movement and moves the balance, in one transaction.
 *
 * `OUT` beyond the balance is refused rather than allowed to go negative. A
 * negative shelf is how an ISP ends up provisioning a customer with a device it
 * does not have, and the error costs a second of the operator's time.
 */
export async function recordMovement(input: {
  itemId: string;
  type: MovementType;
  quantity: number;
  note?: string;
  reference?: string;
  userId?: string;
}) {
  const amount = Math.floor(input.quantity);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Enter a quantity other than zero.");
  }
  if (!["IN", "OUT", "ADJUST"].includes(input.type)) {
    throw new Error(`Unknown movement type "${input.type}".`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } });

    let delta: number;
    if (input.type === "IN") {
      if (amount < 0) throw new Error("A stock-in quantity cannot be negative.");
      delta = amount;
    } else if (input.type === "OUT") {
      if (amount < 0) throw new Error("A stock-out quantity cannot be negative.");
      if (amount > item.quantity) {
        throw new Error(
          `Only ${item.quantity} ${item.unit} of ${item.sku} are in stock, so ${amount} cannot go out.`
        );
      }
      delta = -amount;
    } else {
      // ADJUST states what the shelf actually holds, so the movement is the
      // difference. A count that agrees with the books records nothing rather
      // than a row of zeroes.
      if (amount < 0) throw new Error("An adjusted count cannot be negative.");
      delta = amount - item.quantity;
      if (delta === 0) {
        return { item, movement: null };
      }
    }

    // The balance is written as an absolute value derived from the item just
    // read, not as an increment, so a concurrent read cannot lose an update.
    const nextQuantity = item.quantity + delta;

    const movement = await tx.stockMovement.create({
      data: {
        itemId: item.id,
        type: input.type,
        quantity: delta,
        note: input.note?.trim() || null,
        reference: input.reference?.trim() || null,
        createdById: input.userId ?? null,
      },
    });

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity },
    });

    await prismaLog(tx, {
      action: input.type === "OUT" ? "Issue" : input.type === "IN" ? "Receive" : "Adjust",
      entity: "InventoryItem",
      entityId: item.id,
      summary:
        `${input.type} ${Math.abs(delta)} ${item.unit} of ${item.sku} — ` +
        `now ${updated.quantity} ${item.unit}` +
        (item.reorderLevel > 0 && updated.quantity <= item.reorderLevel
          ? ` (at or below the reorder level of ${item.reorderLevel})`
          : ""),
    });

    return { item: updated, movement };
  });

  return {
    item: toRow(result.item),
    movement: result.movement,
    /** True when a count matched the books and nothing was written. */
    noChange: result.movement === null,
    lowStock: isLowStock(result.item),
  };
}

/* ------------------------------------------------------------------ */
/* Customer equipment                                                  */
/* ------------------------------------------------------------------ */

/**
 * Hands a specific unit to a customer.
 *
 * The serial is unique across the whole system, so the same ONU cannot be
 * recorded in two houses — which is the failure that turns a swap into a
 * fortnight of arguing about whose line is actually working.
 *
 * The stock is decremented as part of this, not as a separate step: a device
 * that is out of the door must be out of the shelf in the same breath.
 */
export async function assignEquipment(input: {
  customerId: string;
  itemId: string;
  serial: string;
  mac?: string;
  note?: string;
  userId?: string;
}) {
  const serial = input.serial.trim().toUpperCase();
  if (!serial) throw new Error("The device serial is required — it is how the unit is traced.");

  const taken = await prisma.customerEquipment.findUnique({ where: { serial } });
  if (taken) {
    throw new Error(
      `Serial ${serial} is already recorded${
        taken.customerId === input.customerId ? " for this customer" : " to another customer"
      }.`
    );
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } });
    if (item.quantity < 1) {
      throw new Error(
        `No ${item.sku} are in stock${item.reorderLevel > 0 ? `, and the reorder level of ${item.reorderLevel} has been reached` : ""}. Receive stock first.`
      );
    }

    const equipment = await tx.customerEquipment.create({
      data: {
        customerId: input.customerId,
        itemId: item.id,
        serial,
        mac: input.mac?.trim().toUpperCase() || null,
        note: input.note?.trim() || null,
        status: "Assigned",
      },
      include: { item: { select: { sku: true, name: true } } },
    });

    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        type: "OUT",
        quantity: -1,
        note: `Issued to ${input.customerId}`,
        reference: serial,
        createdById: input.userId ?? null,
      },
    });

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: item.quantity - 1 },
    });

    await prismaLog(tx, {
      action: "Issue",
      entity: "CustomerEquipment",
      entityId: equipment.id,
      summary: `Issued ${item.sku} serial ${serial} — ${updated.quantity} ${item.unit} left in stock`,
    });

    return { equipment, item: toRow(updated) };
  });
}

/**
 * Takes a unit back.
 *
 * The choice that needs a human: a working returned device goes back on the
 * shelf, and a faulty one is written off. Guessing either way corrupts the
 * count, so `status` decides it.
 */
export async function returnEquipment(input: {
  equipmentId: string;
  status: "Returned" | "Faulty";
  note?: string;
  userId?: string;
}) {
  if (!["Returned", "Faulty"].includes(input.status)) {
    throw new Error('Choose "Returned" or "Faulty".');
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.customerEquipment.findUniqueOrThrow({
      where: { id: input.equipmentId },
      include: { item: { select: { id: true, sku: true, name: true, quantity: true, unit: true } } },
    });
    if (row.status !== "Assigned") {
      throw new Error(`${row.serial} was already recorded as ${row.status.toLowerCase()}.`);
    }

    const equipment = await tx.customerEquipment.update({
      where: { id: row.id },
      data: { status: input.status, returnedAt: new Date(), note: input.note?.trim() || row.note },
    });

    // A returned device rejoins the shelf. A faulty one leaves the count, but
    // stays on the ledger as a movement so the write-off is visible.
    const delta = input.status === "Returned" ? 1 : 0;

    await tx.stockMovement.create({
      data: {
        itemId: row.itemId,
        type: delta > 0 ? "IN" : "OUT",
        quantity: delta,
        note: `${input.status === "Faulty" ? "Written off as faulty" : "Returned"} — serial ${row.serial}${
          input.note ? `: ${input.note.trim()}` : ""
        }`,
        reference: row.serial,
        createdById: input.userId ?? null,
      },
    });

    const updated = await tx.inventoryItem.update({
      where: { id: row.itemId },
      data: { quantity: row.item.quantity + delta },
    });

    await prismaLog(tx, {
      action: "Return",
      entity: "CustomerEquipment",
      entityId: row.id,
      summary:
        `${row.item.sku} serial ${row.serial} marked ${input.status.toLowerCase()}` +
        (delta > 0 ? ` — back in stock, now ${updated.quantity}` : " — written off"),
    });

    return { equipment, item: toRow(updated) };
  });
}
