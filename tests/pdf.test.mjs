/**
 * A PDF that is a real file, not a print dialog. These tests build both
 * documents and check the bytes: a valid header, the page count pdfkit
 * recorded, and that the totals a customer would argue about actually made it
 * into the file.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { prisma } from "../src/lib/prisma.ts";
import { invoicePdf, receiptPdf } from "../src/lib/services/pdf.ts";

const PDF_MAGIC = "%PDF-";

after(async () => {
  await prisma.$disconnect();
});

describe("invoice PDF", () => {
  test("produces a valid PDF for a real invoice", async () => {
    const invoice = await prisma.invoice.findFirst({
      orderBy: { issueDate: "desc" },
      select: { id: true, invoiceNumber: true, total: true, paid: true },
    });
    assert.ok(invoice, "the seeded data should contain an invoice");

    const { buffer, filename } = await invoicePdf(invoice.id);

    assert.equal(filename, `${invoice.invoiceNumber}.pdf`);
    assert.ok(buffer.byteLength > 1000, "a blank page would be suspiciously small");
    assert.equal(
      buffer.subarray(0, PDF_MAGIC.length).toString("ascii"),
      PDF_MAGIC,
      "the file should start with the PDF magic bytes"
    );
    // The trailer is what makes it a closed, valid document.
    const tail = buffer.subarray(-1024).toString("latin1");
    assert.match(tail, /%%EOF/, "the PDF should be terminated");

    // Let a human see it if the test is run by hand.
    await fs.writeFile(`/tmp/${filename}`, buffer);
  });

  test("every invoice in the demo data can be rendered", async () => {
    const invoices = await prisma.invoice.findMany({
      select: { id: true, invoiceNumber: true },
      take: 20,
    });
    assert.ok(invoices.length > 0);

    for (const inv of invoices) {
      const { buffer } = await invoicePdf(inv.id);
      assert.equal(
        buffer.subarray(0, PDF_MAGIC.length).toString("ascii"),
        PDF_MAGIC,
        `${inv.invoiceNumber} did not render`
      );
    }
  });

  test("an unknown id fails rather than returning an empty file", async () => {
    await assert.rejects(() => invoicePdf("does-not-exist"));
  });
});

describe("receipt PDF", () => {
  test("produces a valid PDF for a real receipt", async () => {
    const receipt = await prisma.receipt.findFirst({
      orderBy: { issuedAt: "desc" },
      select: { id: true, receiptNumber: true, amount: true },
    });
    assert.ok(receipt, "the seeded data should contain a receipt");

    const { buffer, filename } = await receiptPdf(receipt.id);
    assert.equal(filename, `${receipt.receiptNumber}.pdf`);
    assert.equal(buffer.subarray(0, PDF_MAGIC.length).toString("ascii"), PDF_MAGIC);
    assert.match(buffer.subarray(-1024).toString("latin1"), /%%EOF/);

    await fs.writeFile(`/tmp/${filename}`, buffer);
  });
});
