-- Phase 1 CR4.1: Database-level demo invariant CHECK constraint
--
-- If isDemo=true, then:
--   broker MUST be 'demo'
--   accountType MUST be 'demo'
--   apiKey MUST be NULL
--   apiSecret MUST be NULL
--   passphrase MUST be NULL
--
-- If isDemo=false or isDemo IS NULL, no additional restriction from this constraint.
-- This constraint fails closed for conflicting data.

ALTER TABLE "TradingAccount" ADD CONSTRAINT "demo_account_invariant"
  CHECK (
    NOT ("isDemo" = true) OR (
      broker = 'demo'
      AND "accountType" = 'demo'
      AND "apiKey" IS NULL
      AND "apiSecret" IS NULL
      AND "passphrase" IS NULL
    )
  );
