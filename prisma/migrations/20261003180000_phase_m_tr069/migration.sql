-- Phase M: zero-touch ONU provisioning (TR-069 / CWMP).
--
-- Additive only. One new table, no column on an existing one altered, dropped or
-- given a default that would rewrite a row. `Onu.status` is already a free-text
-- String, so the new `Provisioning` value needs no migration at all — which is the
-- only reason this phase does not touch a populated table.

-- ---------------------------------------------------------------------------
-- Tr069Log
-- ---------------------------------------------------------------------------

-- One row per TR-069 operation per device.
--
-- Note what is NOT here: the payload. A pushed configuration carries the
-- customer's PPPoE password, so the table stores a SHA-256 of what was sent
-- instead. That is enough to answer the two questions anyone actually asks of
-- this log — did we try, and was it the same attempt as last time — and it is
-- useless to anyone who reads the table hoping to find a credential.
--
-- `onuId` is nullable and `ON DELETE SET NULL`: a decommissioned ONU is
-- frequently deleted, and its history of what we did to it is exactly the part
-- worth keeping. The serial stays either way, because that is the device's own
-- identity rather than a row id.
CREATE TABLE "Tr069Log" (
    "id"          TEXT NOT NULL,
    "onuId"       TEXT,
    "serialNo"    TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "payloadHash" TEXT,
    "result"      TEXT NOT NULL,
    "detail"      TEXT,
    "actionId"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tr069Log_pkey" PRIMARY KEY ("id")
);

-- "show me everything that happened to this device, newest first" is the query
-- the support page and every test here make.
CREATE INDEX "Tr069Log_serialNo_createdAt_idx" ON "Tr069Log"("serialNo", "createdAt");
CREATE INDEX "Tr069Log_onuId_createdAt_idx" ON "Tr069Log"("onuId", "createdAt");

-- A health view: what is failing, and how often.
CREATE INDEX "Tr069Log_result_createdAt_idx" ON "Tr069Log"("result", "createdAt");

ALTER TABLE "Tr069Log"
    ADD CONSTRAINT "Tr069Log_onuId_fkey"
    FOREIGN KEY ("onuId") REFERENCES "Onu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
