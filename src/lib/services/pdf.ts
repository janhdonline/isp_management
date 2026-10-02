import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { formatCurrency, formatDate } from "@/lib/utils";
import { isCorporate } from "@/lib/enums";

/**
 * Renders an invoice or a receipt to a real PDF file, rather than asking the
 * browser to print the page.
 *
 * The reason this is a document generator and not a print stylesheet: a
 * customer who is emailed a bill a month from now needs a file that still
 * looks the same. A print dialog produces whatever the reader's fonts,
 * margins and header settings happen to be on the day.
 *
 * The layout is A4 with a plain table, because invoices get filed, photocopied
 * and stuck in a register. Nothing here depends on a headless browser, so it
 * runs anywhere the app runs.
 */

const PAGE = { size: "A4" as const, margin: 40 };

type Doc = InstanceType<typeof PDFDocument>;

function header(doc: Doc, company: Record<string, string>, title: string, number: string) {
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(company["company.name"] ?? "ISP", PAGE.margin, PAGE.margin);

  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#555")
    .text(
      [
        company["company.address"],
        company["company.phone"],
        company["company.email"],
      ]
        .filter(Boolean)
        .join("  ·  "),
      { width: 300 }
    )
    .fillColor("#000");

  const right = PAGE.size === "A4" ? 515 - PAGE.margin - 200 : 350;
  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(title, right, PAGE.margin, { width: 200, align: "right" });
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#555")
    .text(number, right, doc.y, { width: 200, align: "right" })
    .fillColor("#000");

  // A rule under the masthead, then the two columns.
  const y = Math.max(doc.y, 90) + 12;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.size === "A4" ? 515 : 350, y).lineWidth(1).strokeColor("#ddd").stroke();
  doc.y = y + 14;

  return y + 8;
}

/** Key/value block on the left, or right, of a two-column layout. */
function fieldBlock(doc: Doc, x: number, y: number, width: number, rows: [string, string][]) {
  let cursor = y;
  for (const [label, value] of rows) {
    doc.fontSize(8).fillColor("#666").font("Helvetica").text(label.toUpperCase(), x, cursor, { width });
    doc
      .fontSize(10)
      .fillColor("#000")
      .font("Helvetica")
      .text(value || "—", x, cursor + 11, { width });
    cursor += 30;
  }
  return cursor;
}

function statusBadge(doc: Doc, status: string) {
  const colour =
    status === "Paid" ? "#0a7" : status === "Overdue" || status === "Due" ? "#c00" : "#a60";
  doc.fontSize(9).font("Helvetica-Bold").fillColor(colour).text(status.toUpperCase());
  doc.fillColor("#000");
}

async function companyDetails() {
  const s = await getSettings();
  return s as Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Invoice                                                             */
/* ------------------------------------------------------------------ */

export async function invoicePdf(invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { customer: true, package: { select: { name: true } } },
  });
  const company = await companyDetails();
  const currency = company["company.currency"] || "BDT";

  const doc = new PDFDocument({ ...PAGE, bufferPages: true });
  const done = collect(doc);

  const top = header(doc, company, "INVOICE", invoice.invoiceNumber);

  // Corporate accounts bill to a company, not to the person who pays it. The
  // company name leads, the billing label says what the money is for, and the
  // account contact stays underneath so somebody can actually ask about it. A Home
  // customer renders exactly what it always did.
  const corporate = isCorporate(invoice.customer.customerType);
  const billedTo: [string, string][] = corporate
    ? [
        ["Company", invoice.customer.companyName ?? invoice.customer.name],
        ...(invoice.customer.billingLabel ? [["Invoice for", invoice.customer.billingLabel] as [string, string]] : []),
        ["Account", invoice.customer.name],
        ["Contact", invoice.customer.contactPerson ?? "—"],
      ]
    : [["Billed to", invoice.customer.name]];

  const leftTop = fieldBlock(doc, PAGE.margin, top, 220, [
    ...billedTo,
    ["Username", invoice.customer.username],
    ["Phone", invoice.customer.phone],
    ["Address", invoice.customer.address || "—"],
  ]);

  fieldBlock(doc, 290, top, 200, [
    ["Invoice date", formatDate(invoice.issueDate)],
    ["Due date", formatDate(invoice.dueDate)],
    ["Package", invoice.package?.name || "—"],
    ["Period", invoice.note || "—"],
  ]);
  statusBadge(doc, invoice.status);
  doc.y = Math.max(leftTop, doc.y) + 10;

  // Line items. One row per charge keeps the arithmetic visible to whoever
  // is auditing the bill.
  const rowY = doc.y;
  const col = { item: PAGE.margin, qty: 320, rate: 380, amount: 455 };
  doc.fontSize(8).fillColor("#666").font("Helvetica");
  doc.text("DESCRIPTION", col.item, rowY, { width: 260 });
  doc.text("QTY", col.qty, rowY, { width: 50 });
  doc.text("RATE", col.rate, rowY, { width: 70, align: "right" });
  doc.text("AMOUNT", col.amount, rowY, { width: 60, align: "right" });
  doc.y = rowY + 14;
  doc.moveTo(PAGE.margin, doc.y).lineTo(515, doc.y).lineWidth(0.5).strokeColor("#eee").stroke();
  doc.y += 8;

  const rows: [string, string, string][] = [
    [
      `${invoice.package?.name ?? "Subscription"} charge`,
      "1",
      formatCurrency(invoice.amount, currency),
    ],
  ];
  for (const [item, qty, rate] of rows) {
    const y = doc.y;
    doc.fontSize(10).fillColor("#000");
    doc.text(item, col.item, y, { width: 260 });
    doc.text(qty, col.qty, y, { width: 50 });
    doc.text(rate, col.rate, y, { width: 70, align: "right" });
    doc.text(rate, col.amount, y, { width: 60, align: "right" });
    doc.y = y + 18;
  }

  // Totals, right-aligned under the amount column.
  const totals: [string, string][] = [["Subtotal", formatCurrency(invoice.amount, currency)]];
  if (invoice.discount > 0) {
    totals.push(["Discount", `- ${formatCurrency(invoice.discount, currency)}`]);
  }
  if (invoice.vat > 0) totals.push(["VAT", formatCurrency(invoice.vat, currency)]);
  totals.push(["Total", formatCurrency(invoice.total, currency)]);
  totals.push(["Paid", formatCurrency(invoice.paid, currency)]);
  const balance = Math.round((invoice.total - invoice.paid) * 100) / 100;
  totals.push([balance > 0 ? "Balance due" : "Balance", formatCurrency(Math.max(0, balance), currency)]);

  let ty = doc.y + 8;
  for (const [label, value] of totals) {
    const strong = label === "Total" || label === "Balance due";
    doc
      .fontSize(strong ? 11 : 10)
      .font(strong ? "Helvetica-Bold" : "Helvetica")
      .fillColor(strong ? "#000" : "#444")
      .text(label, 340, ty, { width: 105, align: "right" });
    doc.text(value, col.amount, ty, { width: 60, align: "right" });
    ty += strong ? 18 : 15;
  }
  doc.fillColor("#000");
  doc.y = ty + 12;

  if (invoice.note) {
    doc.fontSize(8).fillColor("#666").text(invoice.note, PAGE.margin, doc.y, { width: 380 });
    doc.fillColor("#000");
  }

  doc
    .fontSize(8)
    .fillColor("#999")
    .text(
      `Generated ${formatDate(new Date())} · ${company["company.name"] ?? "ISP"} · ${
        company["company.website"] ?? ""
      }`,
      PAGE.margin,
      790,
      { width: 435, align: "center" }
    );

  doc.end();
  return { buffer: await done, filename: `${invoice.invoiceNumber}.pdf` };
}

/* ------------------------------------------------------------------ */
/* Receipt                                                             */
/* ------------------------------------------------------------------ */

export async function receiptPdf(receiptId: string): Promise<{ buffer: Buffer; filename: string }> {
  const receipt = await prisma.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: {
      payment: { include: { customer: true, collectedBy: { select: { name: true } } } },
      invoice: { select: { invoiceNumber: true } },
    },
  });
  const company = await companyDetails();
  const currency = company["company.currency"] || "BDT";

  const doc = new PDFDocument({ ...PAGE });
  const done = collect(doc);

  const top = header(doc, company, "RECEIPT", receipt.receiptNumber);

  const leftTop = fieldBlock(doc, PAGE.margin, top, 220, [
    ["Received from", receipt.payment.customer.name],
    ["Username", receipt.payment.customer.username],
    ["Phone", receipt.payment.customer.phone],
  ]);

  fieldBlock(doc, 290, top, 200, [
    ["Date", formatDate(receipt.issuedAt)],
    ["Against invoice", receipt.invoice?.invoiceNumber ?? "—"],
    ["Method", receipt.payment.method],
    ["Collected by", receipt.payment.collectedBy?.name ?? "System"],
  ]);
  doc.y = Math.max(leftTop, doc.y) + 10;

  // The amount gets its own block: it is the one number a receipt exists for.
  const boxY = doc.y;
  doc.roundedRect(PAGE.margin, boxY, 475, 54, 6).fillColor("#f5f7fa").fill();
  doc.fillColor("#000").fontSize(10).fillColor("#666").text("AMOUNT RECEIVED", PAGE.margin + 14, boxY + 12);
  doc
    .fontSize(20)
    .font("Helvetica-Bold")
    .fillColor("#0a7")
    .text(formatCurrency(receipt.amount, currency), PAGE.margin + 14, boxY + 26);
  doc.fillColor("#000");
  doc.y = boxY + 70;

  doc.fontSize(9).fillColor("#666").text("Thank you for your payment.", PAGE.margin, doc.y);
  doc.fillColor("#000");

  doc
    .fontSize(8)
    .fillColor("#999")
    .text(
      `Generated ${formatDate(new Date())} · ${company["company.name"] ?? "ISP"}`,
      PAGE.margin,
      790,
      { width: 435, align: "center" }
    );

  doc.end();
  return { buffer: await done, filename: `${receipt.receiptNumber}.pdf` };
}

/**
 * Collects the finished document.
 *
 * The listeners are attached before `end()` is called, not after: a small
 * document can emit its data and its end event synchronously, so a listener
 * registered afterwards misses both and the result comes back empty.
 */
function collect(doc: Doc): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
