-- Phase N: OLT vendor adapter framework.
--
-- Additive. One new table, four nullable/defaulted columns on `Olt`. Nothing is
-- dropped, retyped or backfilled with a value a migration would have to invent.
--
-- The interesting column is `snmpCommunityEnc`. It is a **boolean**, not a
-- community string, and that is the whole security design: the community itself
-- lives in an `isSecret` Settings row, so there is no select on `Olt` — in the
-- dashboard, an export, a log line or an API response — that can produce it. The
-- column says only whether one is configured, which is all the sync needs in
-- order to decide whether to skip a cabinet.

CREATE TABLE "RogueOnu" (
    "id"          TEXT NOT NULL,
    "oltId"       TEXT NOT NULL,
    "serialNo"    TEXT NOT NULL,
    "ponIndex"    TEXT,
    "rxPower"     DOUBLE PRECISION,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"  TIMESTAMP(3),
    -- Held only while the rogue is unresolved, so an alert goes out once per
    -- incident rather than once per sync.
    "dedupeKey"   TEXT,
    "notifiedAt"  TIMESTAMP(3),

    CONSTRAINT "RogueOnu_pkey" PRIMARY KEY ("id")
);

-- The claim. Three schedulers poll these cabinets and an operator also presses
-- the button; "have we seen this serial" is a check more than one of them can
-- pass at once, so the index settles it.
CREATE UNIQUE INDEX "RogueOnu_oltId_serialNo_key" ON "RogueOnu"("oltId", "serialNo");
CREATE UNIQUE INDEX "RogueOnu_dedupeKey_key" ON "RogueOnu"("dedupeKey");

-- "what is unresolved right now" — the dashboard widget and the alert path.
CREATE INDEX "RogueOnu_resolvedAt_idx" ON "RogueOnu"("resolvedAt");

-- "has this serial ever been seen anywhere", for a support agent reading a
-- serial off a box.
CREATE INDEX "RogueOnu_serialNo_idx" ON "RogueOnu"("serialNo");

ALTER TABLE "RogueOnu"
    ADD CONSTRAINT "RogueOnu_oltId_fkey"
    FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Per-OLT polling configuration
-- ---------------------------------------------------------------------------

-- Which adapter, not a secret. Null means nobody polls this cabinet, which is a
-- choice and is reported differently from a cabinet that was polled and could not
-- be reached.
ALTER TABLE "Olt" ADD COLUMN "apiVendor" TEXT;

-- Write-only marker, mirroring Router.apiSecretEnc. Deliberately a boolean.
ALTER TABLE "Olt" ADD COLUMN "snmpCommunityEnc" BOOLEAN NOT NULL DEFAULT false;

-- 161 is the SNMP default and the value every OLT shipped with uses. 162 is
-- somewhere in the far north of the port range and is never a real answer.
ALTER TABLE "Olt" ADD COLUMN "snmpPort" INTEGER NOT NULL DEFAULT 161;

-- Why the last poll failed. An unreachable OLT is recorded as Unknown, not
-- Offline: "we have not heard from it" and "it told us it is down" are different
-- facts and only one of them is worth waking anybody for.
ALTER TABLE "Olt" ADD COLUMN "lastError" TEXT;