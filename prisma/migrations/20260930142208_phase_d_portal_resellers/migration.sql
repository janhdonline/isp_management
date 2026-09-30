-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "portalPasswordHash" TEXT,
ADD COLUMN     "portalTokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resellerId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "collectedByResellerId" TEXT;

-- CreateTable
CREATE TABLE "Reseller" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "areaId" TEXT,
    "commissionPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reseller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reseller_status_idx" ON "Reseller"("status");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedByResellerId_fkey" FOREIGN KEY ("collectedByResellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;
