-- Phase 2K: durable append-only AI decision journal.
-- Stores normalized autonomous decisions without arbitrary secret-bearing payloads.

CREATE TABLE "AiDecisionJournal" (
  "id" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "symbol" TEXT,
  "side" TEXT,
  "confidence" DOUBLE PRECISION,
  "strategy" TEXT,
  "timeframe" TEXT,
  "strategyVersion" TEXT,
  "riskEngineVersion" TEXT,
  "supervisorVersion" TEXT,
  "positionNotional" DOUBLE PRECISION,
  "riskAmount" DOUBLE PRECISION,
  "riskPercentOfAllocation" DOUBLE PRECISION,
  "riskReward" DOUBLE PRECISION,
  "marketDataEnvironment" TEXT,
  "marketDataSynthetic" BOOLEAN,
  "marketDataSource" TEXT,
  "marketObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiDecisionJournal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_decision_confidence_range"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100)),
  CONSTRAINT "ai_decision_nonnegative_notional"
    CHECK ("positionNotional" IS NULL OR "positionNotional" >= 0),
  CONSTRAINT "ai_decision_nonnegative_risk_amount"
    CHECK ("riskAmount" IS NULL OR "riskAmount" >= 0),
  CONSTRAINT "ai_decision_nonnegative_risk_pct"
    CHECK ("riskPercentOfAllocation" IS NULL OR "riskPercentOfAllocation" >= 0),
  CONSTRAINT "ai_decision_nonnegative_risk_reward"
    CHECK ("riskReward" IS NULL OR "riskReward" >= 0)
);

CREATE INDEX "AiDecisionJournal_userId_createdAt_idx"
  ON "AiDecisionJournal"("userId", "createdAt");

CREATE INDEX "AiDecisionJournal_botId_createdAt_idx"
  ON "AiDecisionJournal"("botId", "createdAt");

CREATE INDEX "AiDecisionJournal_accountId_createdAt_idx"
  ON "AiDecisionJournal"("accountId", "createdAt");

CREATE INDEX "AiDecisionJournal_cycleId_idx"
  ON "AiDecisionJournal"("cycleId");
