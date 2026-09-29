import { requirePermissionFromRequest, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildWorkbook, type ExcelSheet } from "@/lib/services/excel";
import { startOfDay, endOfDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Reads a possibly-nested field off a row that has been widened to
 * `Record<string, unknown>`. The exported rows carry their relations, but
 * widening them for the sheet loses the generated types, so the path is
 * written out here instead of pretending the shape survived.
 */
function at(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, row);
}

const text = (row: Record<string, unknown>, path: string) => {
  const v = at(row, path);
  return v === null || v === undefined ? "" : String(v);
};

const money = (row: Record<string, unknown>, path: string) => {
  const v = at(row, path);
  return typeof v === "number" ? v : 0;
};

const when = (row: Record<string, unknown>, path: string) => {
  const v = at(row, path);
  return v instanceof Date ? v : null;
};


/**
 * Monthly statements as a real workbook.
 *
 *   GET /api/export/excel?report=customers|invoices|payments|due|expenses
 *   &from=2026-09-01&to=2026-09-30
 *
 * The date range is optional: without it the report covers all time, which is
 * what someone auditing a whole year wants.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "customers";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const PERMISSION: Record<string, string> = {
    customers: "customers.export",
    invoices: "billing.export",
    payments: "payments.export",
    due: "payments.export",
    expenses: "expenses.export",
  };
  const wanted = PERMISSION[report];
  if (!wanted) {
    return Response.json(
      { error: `Unknown report "${report}".`, available: Object.keys(PERMISSION) },
      { status: 400 }
    );
  }

  try {
    await requirePermissionFromRequest(request, wanted as never);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 403;
    return Response.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  const range =
    from || to
      ? {
          gte: startOfDay(new Date(from ?? new Date())),
          lte: endOfDay(new Date(to ?? new Date())),
        }
      : undefined;

  const subtitle =
    from || to
      ? `${from ?? "start"} to ${to ?? "end"}`
      : "All records";

  const sheets: ExcelSheet[] = [];
  let title = "Export";

  if (report === "customers") {
    const rows = await prisma.customer.findMany({
      include: { package: { select: { name: true } }, area: { select: { name: true } } },
      orderBy: { customerCode: "asc" },
    });
    title = "Customers";
    sheets.push({
      name: "Customers",
      subtitle,
      columns: [
        { header: "Customer ID", value: (r) => text(r, "customerCode"), width: 14 },
        { header: "Name", value: (r) => text(r, "name"), width: 24 },
        { header: "Username", value: (r) => text(r, "username"), width: 16 },
        { header: "Phone", value: (r) => text(r, "phone"), width: 15 },
        { header: "Package", value: (r) => text(r, "package.name"), width: 18 },
        { header: "Area", value: (r) => text(r, "area.name"), width: 18 },
        { header: "Connection Date", value: (r) => text(r, "connectionDate"), raw: (r) => when(r, "connectionDate"), width: 16 },
        { header: "Monthly Bill", value: (r) => text(r, "monthlyBill"), raw: (r) => money(r, "monthlyBill"), money: true, width: 14 },
        { header: "Due", value: (r) => text(r, "previousDue"), raw: (r) => money(r, "previousDue"), money: true, width: 14 },
        { header: "Connection", value: (r) => text(r, "connectionStatus"), width: 14 },
        { header: "Billing", value: (r) => text(r, "billingStatus"), width: 12 },
        { header: "Online", value: (r) => text(r, "onlineStatus"), width: 10 },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  } else if (report === "invoices") {
    const rows = await prisma.invoice.findMany({
      where: range ? { issueDate: range } : undefined,
      include: { customer: { select: { customerCode: true, name: true, username: true } } },
      orderBy: { issueDate: "desc" },
    });
    title = "Invoices";
    sheets.push({
      name: "Invoices",
      subtitle,
      columns: [
        { header: "Invoice", value: (r) => text(r, "invoiceNumber"), width: 14 },
        { header: "Customer ID", value: (r) => text(r, "customer.customerCode"), width: 14 },
        { header: "Customer", value: (r) => text(r, "customer.name"), width: 24 },
        { header: "Username", value: (r) => text(r, "customer.username"), width: 16 },
        { header: "Issue Date", value: (r) => text(r, "issueDate"), raw: (r) => when(r, "issueDate"), width: 14 },
        { header: "Due Date", value: (r) => text(r, "dueDate"), raw: (r) => when(r, "dueDate"), width: 14 },
        { header: "Amount", value: (r) => text(r, "amount"), raw: (r) => money(r, "amount"), money: true, width: 14 },
        { header: "Discount", value: (r) => text(r, "discount"), raw: (r) => money(r, "discount"), money: true, width: 12 },
        { header: "VAT", value: (r) => text(r, "vat"), raw: (r) => money(r, "vat"), money: true, width: 12 },
        { header: "Total", value: (r) => text(r, "total"), raw: (r) => money(r, "total"), money: true, width: 14 },
        { header: "Paid", value: (r) => text(r, "paid"), raw: (r) => money(r, "paid"), money: true, width: 14 },
        { header: "Status", value: (r) => text(r, "status"), width: 12 },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  } else if (report === "payments" || report === "due") {
    const rows = await prisma.payment.findMany({
      where: {
        ...(report === "due" ? {} : range ? { paymentDate: range } : {}),
        ...(report === "due" ? { customer: { previousDue: { gt: 0 } } } : {}),
      },
      include: {
        customer: { select: { customerCode: true, name: true, username: true, previousDue: true } },
        account: { select: { name: true } },
      },
      orderBy: { paymentDate: "desc" },
    });
    title = report === "due" ? "Outstanding Dues" : "Payments";
    sheets.push({
      name: title,
      subtitle: report === "due" ? "Customers with an outstanding balance" : subtitle,
      columns: [
        { header: "Payment", value: (r) => text(r, "paymentId"), width: 14 },
        { header: "Date", value: (r) => text(r, "paymentDate"), raw: (r) => when(r, "paymentDate"), width: 14 },
        { header: "Customer ID", value: (r) => text(r, "customer.customerCode"), width: 14 },
        { header: "Customer", value: (r) => text(r, "customer.name"), width: 24 },
        { header: "Username", value: (r) => text(r, "customer.username"), width: 16 },
        { header: "Method", value: (r) => text(r, "method"), width: 12 },
        { header: "Account", value: (r) => text(r, "account.name"), width: 16 },
        { header: "Amount", value: (r) => String(money(r, "amount")), raw: (r) => money(r, "amount"), money: true, width: 14 },
        { header: "Total Due", value: (r) => String(money(r, "customer.previousDue")), raw: (r) => money(r, "customer.previousDue"), money: true, width: 14 },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  } else {
    const rows = await prisma.expense.findMany({
      where: range ? { date: range } : undefined,
      include: { account: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
    title = "Expenses";
    sheets.push({
      name: "Expenses",
      subtitle,
      columns: [
        { header: "Date", value: (r) => text(r, "date"), raw: (r) => when(r, "date"), width: 14 },
        { header: "Category", value: (r) => text(r, "category"), width: 20 },
        { header: "Description", value: (r) => text(r, "description"), width: 30 },
        { header: "Vendor", value: (r) => text(r, "vendor"), width: 20 },
        { header: "Account", value: (r) => text(r, "account.name"), width: 16 },
        { header: "Amount", value: (r) => String(money(r, "amount")), raw: (r) => money(r, "amount"), money: true, width: 14 },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  const { buffer, filename } = await buildWorkbook(title, sheets, {
    landscape: sheets[0]?.columns.length > 8,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-length": String(buffer.byteLength),
      "content-disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
