-- Phase S, follow-up: correct the backup-code timestamp column name.
--
-- 20261005090000 created `backupCodesEncUsedAt`; the schema says
-- `backupCodesUsedAt`. Editing that file would change nothing on any database that
-- has already applied it, so the rename lives here.
--
-- `backupCodesUsedAt` records *that* a recovery code was spent, not when — the
-- ledger rows carry the times. Nothing else reads it, and it is nullable, so this
-- is a rename and not a migration of data.

ALTER TABLE "User" RENAME COLUMN "backupCodesEncUsedAt" TO "backupCodesUsedAt";
