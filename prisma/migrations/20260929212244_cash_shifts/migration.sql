-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "shiftNumber" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openingFloat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "countedCash" DOUBLE PRECISION,
    "expectedCash" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "note" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_shiftNumber_key" ON "CashShift"("shiftNumber");

-- CreateIndex
CREATE INDEX "CashShift_accountId_status_idx" ON "CashShift"("accountId", "status");

-- CreateIndex
CREATE INDEX "CashShift_openedAt_idx" ON "CashShift"("openedAt");

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
