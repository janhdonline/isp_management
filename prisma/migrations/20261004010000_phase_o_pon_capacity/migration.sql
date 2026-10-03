-- Phase O: PON port capacity planning.
--
-- One nullable column. No table, because usage is *derived* from the ONU rows
-- rather than stored: a stored count is a second copy of a fact that `Onu.ponIndex`
-- already holds, and it would be wrong the moment an ONU moved.
--
-- There is deliberately nothing to backfill. `null` means "use the network default",
-- so every existing cabinet gets the GPON 64:1 without a migration having to know
-- what any particular cabinet is actually configured to.

ALTER TABLE "Olt" ADD COLUMN "splitRatio" INTEGER;
