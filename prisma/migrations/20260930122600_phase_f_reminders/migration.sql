-- Reminders are exactly-once per (customer, invoice, kind, day). The unique index
-- is the enforcement: a scheduled job is fired by several schedulers and two runs
-- in the same second must produce one row, which a check-then-insert cannot
-- guarantee.
--
-- `notes` records which channels a reminder was tried on before it was delivered,
-- because a fallback that worked is invisible anywhere else.
ALTER TABLE "Notification" ADD COLUMN     "idempotencyKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN     "notes" TEXT;

CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");
