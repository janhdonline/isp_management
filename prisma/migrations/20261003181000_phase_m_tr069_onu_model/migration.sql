-- Phase M, follow-up: the model an Inform reported.
--
-- Split out rather than appended to 20261003180000, which is already applied —
-- editing a migration that has run is a change that silently does nothing on
-- every database that has already run it.
--
-- Vendor alone ("Huawei") does not identify a firmware, and "MA5800" tells an
-- operator which image to look at when an ONU misbehaves. Nullable, because an
-- Inform need not carry one, and because every ONU predating this phase has no
-- value to fill in — this is not something a migration can honestly invent.

ALTER TABLE "Onu" ADD COLUMN "model" TEXT;
