-- Numeric ordering for "next free address".
--
-- `ip` stays the human-readable value and keeps its uniqueness. `sortKey` is the
-- same address zero-padded per octet so that a plain lexical sort is a numeric
-- one — plain string ordering puts "10.30.0.10" before "10.30.0.2", which is
-- correct as text and wrong as a subnet.
--
-- Backfilled from the existing rows so a pool created before this migration is
-- still ordered correctly.
ALTER TABLE "IpAllocation" ADD COLUMN "sortKey" TEXT;

UPDATE "IpAllocation"
SET "sortKey" = split_part("ip", '.', 1) || '.' ||
                 lpad(split_part("ip", '.', 2), 3, '0') || '.' ||
                 lpad(split_part("ip", '.', 3), 3, '0') || '.' ||
                 lpad(split_part("ip", '.', 4), 3, '0')
WHERE "ip" ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$';

-- Anything that did not parse cannot be ordered, and cannot be allocated either;
-- park it at the end rather than losing the row.
UPDATE "IpAllocation" SET "sortKey" = 'zzz.' || "ip" WHERE "sortKey" IS NULL;

ALTER TABLE "IpAllocation" ALTER COLUMN "sortKey" SET NOT NULL;

CREATE INDEX "IpAllocation_poolId_sortKey_idx" ON "IpAllocation"("poolId", "sortKey");
