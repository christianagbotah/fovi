-- Phase 2M: first-class market-regime provenance for durable AI decisions.

ALTER TABLE "AiDecisionJournal"
  ADD COLUMN "marketRegime" TEXT,
  ADD COLUMN "regimeEngineVersion" TEXT;
