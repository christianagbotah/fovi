-- Phase 3F: revocable server-side refresh sessions
--
-- Refresh secrets are never persisted in plaintext. Only SHA-256 token hashes
-- are stored. Rotation keeps the consumed row so reuse can revoke the active
-- token family. Session lifetime is absolute rather than indefinitely sliding.

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_tokenHash_key"
  ON "AuthSession"("tokenHash");

CREATE INDEX "AuthSession_userId_idx"
  ON "AuthSession"("userId");

CREATE INDEX "AuthSession_familyId_idx"
  ON "AuthSession"("familyId");

CREATE INDEX "AuthSession_expiresAt_idx"
  ON "AuthSession"("expiresAt");

CREATE INDEX "AuthSession_familyId_revokedAt_idx"
  ON "AuthSession"("familyId", "revokedAt");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
