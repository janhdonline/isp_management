import { getSessionFromRequest, requirePermissionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCustomerFull, listCustomers } from "@/lib/services/customers";
import { getInvoiceFull, listInvoices, listPayments } from "@/lib/services/billing-queries";
import { getAllPackages } from "@/lib/services/packages";
import { getDashboardStats } from "@/lib/services/dashboard";
import { listAccounts } from "@/lib/services/accounts";
import { listOnline } from "@/lib/services/network";
import { prismaLog } from "@/lib/services/activity";
import { recordPayment, syncCustomerBilling } from "@/lib/services/billing";
import {
  enforceReconnect,
  enforceSuspend,
  maybeAutoReconnect,
} from "@/lib/services/network-enforcement";
import { disconnectCustomer, reconnectCustomer, renewCustomer, suspendCustomer } from "@/lib/services/customers";
import { round2 } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/enums";

/**
 * Thin REST facade over the service layer so an external POS / mobile app or
 * the RADIUS integration can read the same data the UI renders
 * (ISP.md rule 3 & 4: the UI never talks to the database directly).
 */
type Query = Parameters<typeof listCustomers>[0] & { id?: string };

const ROUTES: Record<string, (q: Query) => unknown> = {
  customers: (q) => listCustomers(q),
  /** Single record reads, for clients that already know the id. */
  customer: (q) => (q.id ? getCustomerFull(q.id) : Promise.resolve(null)),
  invoice: (q) => (q.id ? getInvoiceFull(q.id) : Promise.resolve(null)),
  invoices: (q) => listInvoices(q),
  payments: (q) => listPayments(q),
  packages: () => getAllPackages(),
  accounts: () => listAccounts(),
  online: (q) => listOnline(q),
  stats: () => getDashboardStats(),
};

function sp(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function parse(params: Record<string, string>): Query {
  return {
    id: params.id,
    page: Number(params.page ?? 1) || 1,
    perPage: Math.min(200, Number(params.perPage ?? 25) || 25),
    q: params.q,
    status: params.status,
    areaId: params.areaId,
    packageId: params.packageId,
    method: params.method,
    from: params.from,
    to: params.to,
  };
}

/** Serialise BigInt columns that Prisma returns. */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

export async function GET(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { resource } = await ctx.params;
  const handler = ROUTES[resource];
  if (!handler) {
    return Response.json(
      { error: `Unknown resource "${resource}"`, available: Object.keys(ROUTES) },
      { status: 404 }
    );
  }

  try {
    const result = await handler(parse(sp(request.url)));
    return Response.json(jsonSafe(result), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* Write endpoint (POS / mobile clients)                               */
/* ------------------------------------------------------------------ */

const paymentBody = z.object({
  customerId: z.string().min(1),
  invoiceId: z.string().optional().nullable(),
  amount: z.number().positive(),
  discount: z.number().min(0).optional(),
  method: z.enum(PAYMENT_METHODS),
  accountId: z.string().min(1),
  transactionId: z.string().optional(),
  paymentDate: z.coerce.date().optional(),
  note: z.string().optional(),
});

/**
 * Payment intake. Runs in a single database transaction so the invoice,
 * customer due, account balance and receipt can never drift apart.
 */
/**
 * Customer lifecycle over REST.
 *
 * Suspending from the browser works, but an ISP with a billing system of its
 * own — or a handheld terminal in the field — has no way to reach it, and the
 * most common automated case by far is "this account is unpaid, cut it off". The
 * same enforcement path is used as the screens, so a suspension from here is
 * queued for the router in exactly the same way.
 *
 * The response reports what happened on the network separately from what
 * happened in the database. Those can differ, and a caller that is told "done"
 * when only the database changed will never check again.
 */
export async function POST(request: Request, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  if (resource !== "payments" && resource !== "lifecycle") {
    return Response.json({ error: `POST is not supported for "${resource}"` }, { status: 405 });
  }

  if (resource === "lifecycle") {
    const body = (await request.json().catch(() => null)) as {
      customerId?: string;
      action?: string;
      reason?: string;
      days?: number;
    } | null;

    const action = body?.action;
    if (!body?.customerId || !action) {
      return Response.json(
        { error: "customerId and action are required" },
        { status: 400 }
      );
    }

    try {
      await requirePermissionFromRequest(request, "customers.edit");
    } catch {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: body.customerId },
      select: { id: true, name: true, username: true, connectionStatus: true },
    });
    if (!customer) {
      return Response.json({ error: "No such customer" }, { status: 404 });
    }

    try {
      const id = body.customerId;

      if (action === "suspend") {
        if (!body.reason?.trim()) {
          return Response.json({ error: "A reason is required to suspend" }, { status: 400 });
        }
        await prisma.$transaction((tx) =>
          suspendCustomer(tx, id, body.reason!.trim())
        );
        // After the commit, never inside it: a router call held open across the
        // transaction holds a connection and a lock for as long as it takes.
        const network = await enforceSuspend(id);
        return Response.json({
          ok: true,
          customerId: id,
          connectionStatus: "Suspended",
          // Deliberately not flattened into `ok`: the database is correct and
          // the router may not be, and the caller has to be able to tell.
          network: { applied: network.ok, detail: network.detail, queued: network.queued ?? false },
        });
      }

      if (action === "reconnect") {
        await prisma.$transaction((tx) => reconnectCustomer(tx, id));
        const network = await enforceReconnect(id);
        return Response.json({
          ok: true,
          customerId: id,
          connectionStatus: "Active",
          network: { applied: network.ok, detail: network.detail, queued: network.queued ?? false },
        });
      }

      if (action === "disconnect") {
        if (!body.reason?.trim()) {
          return Response.json({ error: "A reason is required to disconnect" }, { status: 400 });
        }
        await prisma.$transaction((tx) =>
          disconnectCustomer(tx, id, body.reason!.trim())
        );
        const network = await enforceSuspend(id);
        return Response.json({
          ok: true,
          customerId: id,
          connectionStatus: "Disconnected",
          network: { applied: network.ok, detail: network.detail, queued: network.queued ?? false },
        });
      }

      if (action === "renew") {
        const days = Number(body.days ?? 0);
        if (!days || days < 1 || days > 3650) {
          return Response.json({ error: "days must be between 1 and 3650" }, { status: 400 });
        }
        await prisma.$transaction((tx) => renewCustomer(tx, id, days));
        return Response.json({ ok: true, customerId: id, extendedDays: days });
      }

      return Response.json(
        { error: `Unknown action "${action}". Use suspend, reconnect, disconnect, or renew.` },
        { status: 400 }
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Action failed" },
        { status: 400 }
      );
    }
  }

  let session;
  try {
    session = await requirePermissionFromRequest(request, "payments.create");
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = paymentBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const d = parsed.data;
  if (d.discount && d.discount > d.amount) {
    return Response.json({ error: "Discount cannot exceed amount" }, { status: 400 });
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      // never accept more than the invoice balance
      if (d.invoiceId) {
        const inv = await tx.invoice.findUniqueOrThrow({
          where: { id: d.invoiceId },
          select: { total: true, paid: true, status: true },
        });
        if (inv.status === "Cancelled") throw new Error("Invoice is cancelled");
        const balance = Math.round((inv.total - inv.paid) * 100) / 100;
        const net = Math.round((d.amount - (d.discount ?? 0)) * 100) / 100;
        if (net <= 0) throw new Error("Net amount must be greater than zero");
        if (net > balance + 0.009) {
          throw new Error(`Amount exceeds the invoice balance of ${balance}`);
        }
      }

      const created = await recordPayment(tx, {
        customerId: d.customerId,
        invoiceId: d.invoiceId ?? null,
        amount: d.amount,
        discount: d.discount,
        method: d.method,
        accountId: d.accountId,
        transactionId: d.transactionId,
        paymentDate: d.paymentDate ?? new Date(),
        note: d.note,
        collectedById: session.id,
      });
      await prismaLog(
        tx,
        {
          action: "Create",
          entity: "Payment",
          entityId: created.id,
          summary: `Payment ${created.paymentId} of ${round2(d.amount)} received via API`,
        },
        session.id
      );
      return created;
    });

    await syncCustomerBilling(d.customerId);

    // Same rule as the screens: a payment that clears the dues puts a suspended
    // customer's line back, so an API-driven payment behaves identically to one
    // typed into the UI.
    const restored = await maybeAutoReconnect(d.customerId, session.id);

    return Response.json(
      {
        ok: true,
        payment: {
          id: payment.id,
          paymentId: payment.paymentId,
          amount: payment.amount,
          method: payment.method,
          paymentDate: payment.paymentDate,
        },
        // Reported rather than hidden: a caller integrating against this should
        // be able to tell whether the line came back.
        network: restored
          ? { reconnected: restored.ok, detail: restored.detail }
          : null,
      },
      { status: 201 }
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Payment failed" },
      { status: 400 }
    );
  }
}
