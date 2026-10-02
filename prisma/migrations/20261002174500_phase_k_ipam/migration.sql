-- IP pool management.
--
-- Both tables are added and left empty. `Customer.ipAddress` is *not* touched: it
-- holds whatever the operator typed over years, some of it not an address in any
-- pool, and rewriting it from a migration would be destructive and wrong. The
-- adoption of existing addresses is a deliberate operator action in the UI, which
-- can see the pool before marking anything Allocated.

CREATE TABLE "IpPool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "gateway" TEXT,
    "dns" TEXT,
    "routerId" TEXT,
    "areaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpPool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IpAllocation" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Free',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAllocation_pkey" PRIMARY KEY ("id")
);

-- The two constraints that make concurrency safe rather than merely unlikely:
-- an address is in at most one place, and a customer holds at most one address.
CREATE UNIQUE INDEX "IpAllocation_ip_key" ON "IpAllocation"("ip");
CREATE UNIQUE INDEX "IpAllocation_customerId_key" ON "IpAllocation"("customerId");
CREATE UNIQUE INDEX "IpPool_name_key" ON "IpPool"("name");

CREATE INDEX "IpPool_cidr_idx" ON "IpPool"("cidr");
CREATE INDEX "IpAllocation_poolId_status_idx" ON "IpAllocation"("poolId", "status");
CREATE INDEX "IpAllocation_status_idx" ON "IpAllocation"("status");

ALTER TABLE "IpAllocation" ADD CONSTRAINT "IpAllocation_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "IpPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IpAllocation" ADD CONSTRAINT "IpAllocation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpPool" ADD CONSTRAINT "IpPool_routerId_fkey"
  FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpPool" ADD CONSTRAINT "IpPool_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;
