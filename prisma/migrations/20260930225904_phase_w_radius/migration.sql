-- AlterTable
ALTER TABLE "Router" ADD COLUMN     "useRadius" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RadiusAccounting" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "acctSessionId" TEXT NOT NULL,
    "nasIp" TEXT NOT NULL,
    "nasIdentifier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Start',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 0,
    "inputOctets" BIGINT NOT NULL DEFAULT 0,
    "outputOctets" BIGINT NOT NULL DEFAULT 0,
    "framedIpAddress" TEXT,
    "callingStationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadiusAccounting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiusLog" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "username" TEXT,
    "nasIp" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadiusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiusHealth" (
    "id" TEXT NOT NULL DEFAULT 'radius',
    "packetsIn" INTEGER NOT NULL DEFAULT 0,
    "packetsOut" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadiusHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RadiusAccounting_acctSessionId_key" ON "RadiusAccounting"("acctSessionId");

-- CreateIndex
CREATE INDEX "RadiusAccounting_username_idx" ON "RadiusAccounting"("username");

-- CreateIndex
CREATE INDEX "RadiusAccounting_stoppedAt_idx" ON "RadiusAccounting"("stoppedAt");

-- CreateIndex
CREATE INDEX "RadiusLog_createdAt_idx" ON "RadiusLog"("createdAt");

-- CreateIndex
CREATE INDEX "RadiusLog_type_createdAt_idx" ON "RadiusLog"("type", "createdAt");
