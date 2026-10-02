-- Device-down alerts.
--
-- `dedupeKey` is unique and holds only for the *open* alert, which is what makes
-- one incident produce one row: every monitor run while the device is still down
-- attempts the same key and is rejected by the index. Resolving the alert nulls the
-- key, which frees it for the next incident.
--
-- Concurrent runs cannot both insert because the index settles it; a check-then-
-- insert would let both pass the check.
CREATE TABLE "DeviceAlert" (
    "id" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "detail" TEXT,
    "dedupeKey" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifyChannel" TEXT,
    "notifyError" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceAlert_dedupeKey_key" ON "DeviceAlert"("dedupeKey");
CREATE INDEX "DeviceAlert_status_openedAt_idx" ON "DeviceAlert"("status", "openedAt");
CREATE INDEX "DeviceAlert_deviceType_deviceId_idx" ON "DeviceAlert"("deviceType", "deviceId");
CREATE INDEX "DeviceAlert_kind_status_idx" ON "DeviceAlert"("kind", "status");
