-- The customer wallet's ledger. `Customer.advancePayment` stays as a cached
-- balance; this table is the truth, and the two are written in one transaction.
--
-- `balanceAfter` is a running snapshot rather than something derived on read: an
-- audit question ("what did this customer actually hold on the day?") should not
-- need a SUM over their whole history.
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "paymentId" TEXT,
    "invoiceId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletTransaction_customerId_createdAt_idx" ON "WalletTransaction"("customerId", "createdAt");
CREATE INDEX "WalletTransaction_type_idx" ON "WalletTransaction"("type");
CREATE INDEX "WalletTransaction_paymentId_idx" ON "WalletTransaction"("paymentId");
CREATE INDEX "WalletTransaction_invoiceId_idx" ON "WalletTransaction"("invoiceId");

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
