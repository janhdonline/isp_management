-- Phase L: GIS fiber map + fault localization.
--
-- Everything here is additive. No column is dropped, renamed, retyped or given a
-- default that would rewrite a row: the geo columns are nullable so a device with
-- no known position stays off the map rather than being pinned somewhere it is
-- not, and `dedupeKey` is nullable so every existing ticket is unaffected.
--
-- "Optional" is the whole design here. An ISP that has never recorded where its
-- OLTs stand cannot be made to, retroactively, by a migration — and a migration
-- that guessed would put cabinets in the wrong place, which on a fiber map is
-- worse than no map.

-- ---------------------------------------------------------------------------
-- Coordinates
-- ---------------------------------------------------------------------------

ALTER TABLE "Area"   ADD COLUMN "latitude"  DOUBLE PRECISION;
ALTER TABLE "Area"   ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "Olt"    ADD COLUMN "latitude"  DOUBLE PRECISION;
ALTER TABLE "Olt"    ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "Onu"    ADD COLUMN "latitude"  DOUBLE PRECISION;
ALTER TABLE "Onu"    ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "Router" ADD COLUMN "latitude"  DOUBLE PRECISION;
ALTER TABLE "Router" ADD COLUMN "longitude" DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- Fiber routes
-- ---------------------------------------------------------------------------

-- One row per fiber run. `points` is an ordered [{lat,lng}] array as JSONB,
-- because the array is only ever read and written whole — there is nothing to
-- query inside a route, and a waypoint-per-row table would make re-ordering a
-- route a two-dozen-write affair.
CREATE TABLE "FiberRoute" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "points"    JSONB NOT NULL,
    "oltId"     TEXT,
    "areaId"    TEXT,
    "note"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiberRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FiberRoute_oltId_idx" ON "FiberRoute"("oltId");
CREATE INDEX "FiberRoute_areaId_idx" ON "FiberRoute"("areaId");

ALTER TABLE "FiberRoute"
    ADD CONSTRAINT "FiberRoute_oltId_fkey"
    FOREIGN KEY ("oltId") REFERENCES "Olt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FiberRoute"
    ADD CONSTRAINT "FiberRoute_areaId_fkey"
    FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Exactly one ticket per fiber incident
-- ---------------------------------------------------------------------------

-- The claim pattern, as on `Notification.idempotencyKey` and
-- `DeviceAlert.dedupeKey`. The fault job runs from three schedulers in this
-- deployment and two of them firing in the same minute must produce one ticket,
-- which a check-then-insert cannot guarantee. Unique indexes ignore NULLs in
-- Postgres, so ordinary tickets are unaffected.
ALTER TABLE "Ticket" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Ticket_dedupeKey_key" ON "Ticket"("dedupeKey");