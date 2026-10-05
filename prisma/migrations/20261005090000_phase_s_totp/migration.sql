-- Phase S: staff TOTP two-factor authentication.
--
-- Four nullable columns plus one boolean on `User`. Every existing user keeps
-- exactly the behaviour they had: `totpEnabled` defaults to false, so signing in
-- still takes a password and nothing else.
--
-- `totpSecretEnc` holds AES-256-GCM ciphertext, not the secret. `backupCodesEnc`
-- holds hashes, not codes — a plaintext recovery code sitting in the user table is
-- a second password for every account whose 2FA is being used as a second factor,
-- which defeats the point of having one.

ALTER TABLE "User" ADD COLUMN "totpSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "backupCodesEnc" TEXT;
-- The timestamp column is `backupCodesEncUsedAt`. That is the wrong name for the
-- schema's `backupCodesUsedAt`, and the rename lives in the *next* migration:
-- editing this file changes nothing on any database that has already run it.
ALTER TABLE "User" ADD COLUMN "backupCodesEncUsedAt" TIMESTAMP(3);
