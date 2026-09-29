-- CreateTable
CREATE TABLE "NetworkAction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "routerId" TEXT,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payload" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetworkAction_status_createdAt_idx" ON "NetworkAction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NetworkAction_customerId_idx" ON "NetworkAction"("customerId");

-- AddForeignKey
ALTER TABLE "NetworkAction" ADD CONSTRAINT "NetworkAction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
