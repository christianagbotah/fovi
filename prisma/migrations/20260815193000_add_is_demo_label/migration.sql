-- Migration: add_is_demo_label
-- Date: 2026-08-15
--
-- Adds a nullable `label` column and a non-nullable `isDemo` boolean column
-- (defaulting to false) to the "TradingAccount" table.
--
-- Backfill logic: Existing demo accounts are identified as rows where the broker
-- is literally 'demo', accountType is 'demo', and all API credential fields
-- (apiKey, apiSecret, passphrase) are NULL — meaning they have no real broker
-- credentials attached. These rows are flagged with isDemo = true so that the
-- application can reliably distinguish demo/paper accounts from live accounts
-- going forward.

ALTER TABLE "TradingAccount" ADD COLUMN "label" TEXT;

ALTER TABLE "TradingAccount" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

UPDATE "TradingAccount" SET "isDemo" = true WHERE broker = 'demo' AND "accountType" = 'demo' AND "apiKey" IS NULL AND "apiSecret" IS NULL AND "passphrase" IS NULL;
