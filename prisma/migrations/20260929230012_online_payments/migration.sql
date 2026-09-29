-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "gatewayProvider" TEXT,
ADD COLUMN     "gatewayStatus" TEXT,
ADD COLUMN     "gatewayTxnId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_gatewayTxnId_key" ON "Payment"("gatewayTxnId");

-- CreateIndex
CREATE INDEX "Payment_gatewayTxnId_idx" ON "Payment"("gatewayTxnId");
