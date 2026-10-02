-- Corporate / dedicated clients.
--
-- Every company column is nullable, so a Home customer is untouched: no new
-- required field, no changed default, no behaviour difference on the existing
-- flow. NULL means "not a corporate account", which is different from "" and is
-- never what we want to imply.

ALTER TABLE "Customer"
    ADD COLUMN "companyName"    TEXT,
    ADD COLUMN "contactPerson"  TEXT,
    ADD COLUMN "contactPhone"   TEXT,
    ADD COLUMN "tradeLicenseNo" TEXT,
    ADD COLUMN "cirMbps"        DOUBLE PRECISION,
    ADD COLUMN "mirMbps"        DOUBLE PRECISION,
    ADD COLUMN "slaHours"       INTEGER,
    ADD COLUMN "billingLabel"   TEXT;

-- "Dedicated" joins "Corporate" as a customer type (ISP.md §33); the enum lives in
-- the application layer, so no database change is needed for it.
--
-- `slaDueAt` and `escalated` are the seam Phase U reads. Nothing computes SLA
-- compliance here; the ticket just carries when it was due and whether it has been
-- breached.
ALTER TABLE "Ticket"
    ADD COLUMN "slaDueAt"  TIMESTAMP(3),
    ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Ticket_escalated_idx" ON "Ticket"("escalated");
CREATE INDEX "Ticket_slaDueAt_idx" ON "Ticket"("slaDueAt");
