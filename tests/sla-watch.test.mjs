import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { slaWatch } from "../src/lib/services/support.ts";

describe("slaWatch - basic functionality", () => {
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  afterEach(async () => {
    await prisma.ticket.deleteMany();
  });

  test("slaWatch marks overdue tickets as breached", async () => {
    const now = new Date();
    const pastDue = new Date(now.getTime() - 86400000 * 3);

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: "TEST-1",
        subject: "Test ticket",
        problem: "Test problem",
        category: "Other",
        priority: "Critical",
        status: "Open",
        slaDueAt: pastDue,
        slaBreached: false,
        escalated: false,
      },
    });

    const count = await slaWatch(now);

    const updated = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { slaBreached: true, escalated: true },
    });

    assert.strictEqual(updated?.slaBreached, true);
    assert.strictEqual(updated?.escalated, false);
    assert.strictEqual(count, 1);
  });

  test("slaWatch does not touch tickets with future slaDueAt", async () => {
    const now = new Date();
    const futureDue = new Date(now.getTime() + 86400000 * 3);

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: "TEST-2",
        subject: "Test ticket",
        problem: "Test problem",
        category: "Other",
        priority: "Critical",
        status: "Open",
        slaDueAt: futureDue,
        slaBreached: false,
        escalated: false,
      },
    });

    const count = await slaWatch(now);

    const updated = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { slaBreached: true, escalated: true },
    });

    assert.strictEqual(updated?.slaBreached, false);
    assert.strictEqual(updated?.escalated, false);
    assert.strictEqual(count, 0);
  });

  test("slaWatch is idempotent for breached tickets", async () => {
    const now = new Date();
    const pastDue = new Date(now.getTime() - 86400000 * 3);

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: "TEST-3",
        subject: "Test ticket",
        problem: "Test problem",
        category: "Other",
        priority: "Critical",
        status: "Open",
        slaDueAt: pastDue,
        slaBreached: false,
        escalated: false,
      },
    });

    const count1 = await slaWatch(now);
    const count2 = await slaWatch(now);

    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 0);
  });
});