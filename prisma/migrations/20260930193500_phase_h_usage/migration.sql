-- Per-customer daily traffic, aggregated from OnlineSession and RadiusAccounting.
--
-- The unique (customerId, date) is the whole idempotency mechanism: the job upserts
-- on it, so re-running over the same input cannot double-count. A "does the row
-- exist, then insert" check would lose a race against a concurrent run.
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'sessions',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyUsage_customerId_date_key" ON "DailyUsage"("customerId", "date");
CREATE INDEX "DailyUsage_date_idx" ON "DailyUsage"("date");

ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
