import { prisma } from "@/lib/prisma";
import { round2, startOfDay } from "@/lib/utils";
import { nextNumber, type Tx } from "@/lib/counter";
import { prismaLog } from "@/lib/services/activity";

/**
 * Cash shifts and day close.
 *
 * Without this, the cash account is just a number: money leaves it for a
 * refund or a purchase and nothing records who held it or what the till was
 * supposed to be. A shift gives each member of staff their own float and
 * reconciles it at close, so a shortfall is a conversation with one person
 * rather than an argument about the whole day's takings.
 *
 * The numbers here are the ones an owner actually asks for at closing time:
 * what the till started with, what was taken in, what was paid out, what is
 * physically in the drawer, and whether that matches the books.
 */

export type ShiftStatus = "Open" | "Closed";

/** Opens a till for an operator. One open shift per account at a time. */
export async function openShift(input: {
  accountId: string;
  openingFloat: number;
  userId: string;
  note?: string;
}) {
  const opening = round2(input.openingFloat);
  if (opening < 0) throw new Error("Opening float cannot be negative");

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, name: true, type: true, status: true },
  });
  if (account.status !== "Active") throw new Error(`${account.name} is not active`);
  if (account.type !== "Cash") {
    throw new Error("A shift is only meaningful for a cash account");
  }

  const open = await prisma.cashShift.findFirst({
    where: { accountId: input.accountId, status: "Open" },
    select: { id: true, user: { select: { name: true } } },
  });
  if (open) {
    throw new Error(`${open.user.name} already has an open shift on this account`);
  }

  const shift = await prisma.$transaction(async (tx: Tx) => {
    const shiftNumber = await nextNumber(tx, "shift", "SHF-");
    return tx.cashShift.create({
      data: {
        shiftNumber,
        accountId: input.accountId,
        userId: input.userId,
        openingFloat: opening,
        openedAt: new Date(),
        status: "Open",
        note: input.note || null,
      },
    });
  });

  await prismaLog(prisma, {
    action: "Open",
    entity: "CashShift",
    entityId: shift.id,
    summary: `Opened ${shift.shiftNumber} with a float of ${opening}`,
  }, input.userId);
  return shift;
}

/**
 * Closes a shift and reconciles it.
 *
 * `counted` is what is physically in the drawer. The difference against the
 * expected figure is recorded rather than corrected, because a till that
 * silently adjusts itself teaches nobody anything and hides a recurring error.
 */
export async function closeShift(input: {
  shiftId: string;
  countedCash: number;
  userId: string;
  note?: string;
}) {
  const counted = round2(input.countedCash);
  if (counted < 0) throw new Error("Counted cash cannot be negative");

  return prisma.$transaction(async (tx: Tx) => {
    const shift = await tx.cashShift.findUniqueOrThrow({
      where: { id: input.shiftId },
      include: { account: { select: { id: true, name: true } } },
    });
    if (shift.status !== "Open") throw new Error("This shift is already closed");

    // Everything the shift was responsible for, by transaction reference time
    // rather than by who pressed the button — a colleague can record a payment
    // into a shift they are not holding, and it still belongs here.
    const [moneyIn, moneyOut] = await Promise.all([
      tx.accountTransaction.aggregate({
        where: {
          accountId: shift.accountId,
          direction: "Credit",
          date: { gte: shift.openedAt, lte: new Date() },
          type: { in: ["Payment", "Adjustment"] },
        },
        _sum: { amount: true },
      }),
      tx.accountTransaction.aggregate({
        where: {
          accountId: shift.accountId,
          direction: "Debit",
          date: { gte: shift.openedAt, lte: new Date() },
        },
        _sum: { amount: true },
      }),
    ]);

    const taken = round2(moneyIn._sum.amount ?? 0);
    const paidOut = round2(moneyOut._sum.amount ?? 0);
    const expected = round2(shift.openingFloat + taken - paidOut);
    const variance = round2(counted - expected);

    const closed = await tx.cashShift.update({
      where: { id: shift.id },
      data: {
        status: "Closed",
        closedAt: new Date(),
        countedCash: counted,
        expectedCash: expected,
        variance,
        closedById: input.userId,
        note: input.note || shift.note,
      },
    });

    // A variance is written to the ledger as an adjustment so the account
    // balance reflects what is actually in the drawer rather than what the
    // records claim. Without this the account drifts permanently the first time
    // change is given.
    if (variance !== 0) {
      const balance = round2(
        (await tx.account.findUniqueOrThrow({ where: { id: shift.accountId } })).currentBalance
      );
      await tx.accountTransaction.create({
        data: {
          accountId: shift.accountId,
          type: "Adjustment",
          direction: variance > 0 ? "Credit" : "Debit",
          amount: Math.abs(variance),
          description:
            `Cash count ${variance > 0 ? "over" : "short"} by ${Math.abs(variance)} on ${shift.shiftNumber}: counted ${counted}, expected ${expected}`,
          reference: shift.shiftNumber,
          userId: input.userId,
          balance: round2(balance + variance),
          date: new Date(),
        },
      });
      await tx.account.update({
        where: { id: shift.accountId },
        data: { currentBalance: round2(balance + variance) },
      });
    }

    await prismaLog(
      tx,
      {
        action: "Close",
        entity: "CashShift",
        entityId: shift.id,
        summary:
          `Closed ${shift.shiftNumber}: expected ${expected}, counted ${counted}` +
          (variance === 0 ? " (balanced)" : ` (${variance > 0 ? "over" : "short"} by ${Math.abs(variance)})`),
      },
      input.userId
    );

    return { ...closed, taken, paidOut, expected, variance };
  });
}

/** The live figures for an open shift, so the close screen can show them. */
export async function shiftSummary(shiftId: string) {
  const shift = await prisma.cashShift.findUniqueOrThrow({
    where: { id: shiftId },
    include: {
      account: { select: { name: true, type: true } },
      user: { select: { name: true } },
    },
  });

  if (shift.status !== "Open") {
    return {
      shift,
      taken: 0,
      paidOut: 0,
      expected: shift.expectedCash ?? 0,
      payments: 0,
    };
  }

  const [inAgg, outAgg, payments] = await Promise.all([
    prisma.accountTransaction.aggregate({
      where: {
        accountId: shift.accountId,
        direction: "Credit",
        date: { gte: shift.openedAt },
        type: { in: ["Payment", "Adjustment"] },
      },
      _sum: { amount: true },
    }),
    prisma.accountTransaction.aggregate({
      where: { accountId: shift.accountId, direction: "Debit", date: { gte: shift.openedAt } },
      _sum: { amount: true },
    }),
    prisma.payment.count({ where: { accountId: shift.accountId, paymentDate: { gte: shift.openedAt } } }),
  ]);

  const taken = round2(inAgg._sum.amount ?? 0);
  const paidOut = round2(outAgg._sum.amount ?? 0);

  return {
    shift,
    taken,
    paidOut,
    expected: round2(shift.openingFloat + taken - paidOut),
    payments,
  };
}

/**
 * The day's position across every cash account, which is the screen an owner
 * opens at the end of the day.
 */
export async function dayCloseReport(date = new Date()) {
  const day = startOfDay(date);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const accounts = await prisma.account.findMany({
    where: { type: "Cash", status: "Active" },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    accounts.map(async (account) => {
      const [inAgg, outAgg, shifts, openShift] = await Promise.all([
        prisma.accountTransaction.aggregate({
          where: { accountId: account.id, direction: "Credit", date: { gte: day, lte: end } },
          _sum: { amount: true },
        }),
        prisma.accountTransaction.aggregate({
          where: { accountId: account.id, direction: "Debit", date: { gte: day, lte: end } },
          _sum: { amount: true },
        }),
        prisma.cashShift.findMany({
          where: { accountId: account.id, openedAt: { gte: day, lte: end } },
          include: { user: { select: { name: true } }, closedBy: { select: { name: true } } },
          orderBy: { openedAt: "asc" },
        }),
        prisma.cashShift.findFirst({
          where: { accountId: account.id, status: "Open" },
          include: { user: { select: { name: true } } },
        }),
      ]);

      const taken = round2(inAgg._sum.amount ?? 0);
      const paidOut = round2(outAgg._sum.amount ?? 0);
      const variance = round2(shifts.reduce((s, sh) => s + (sh.variance ?? 0), 0));

      return {
        account: { id: account.id, name: account.name, balance: account.currentBalance },
        taken,
        paidOut,
        net: round2(taken - paidOut),
        variance,
        shifts: shifts.map((s) => ({
          id: s.id,
          shiftNumber: s.shiftNumber,
          user: s.user.name,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          openingFloat: s.openingFloat,
          expectedCash: s.expectedCash,
          countedCash: s.countedCash,
          variance: s.variance,
          status: s.status,
          closedBy: s.closedBy?.name ?? null,
        })),
        openShift: openShift
          ? { id: openShift.id, shiftNumber: openShift.shiftNumber, user: openShift.user.name, openedAt: openShift.openedAt }
          : null,
      };
    })
  );

  return {
    date: day,
    rows,
    metrics: {
      taken: round2(rows.reduce((s, r) => s + r.taken, 0)),
      paidOut: round2(rows.reduce((s, r) => s + r.paidOut, 0)),
      net: round2(rows.reduce((s, r) => s + r.net, 0)),
      variance: round2(rows.reduce((s, r) => s + r.variance, 0)),
      openShifts: rows.filter((r) => r.openShift).length,
    },
  };
}
