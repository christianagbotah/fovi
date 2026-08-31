-- Phase 2G: durable per-trade paper settlement ledger
--
-- Each deterministic paper Position and close Order may settle at most once.
-- The row records gross/raw P&L, platform levy, user net realized P&L, and
-- account balance before/after so aggregate accounting can be audited from
-- immutable per-close truth.

CREATE TABLE "PaperTradeSettlement" (
  "id" TEXT NOT NULL,
  "closeOrderId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "exitPrice" DOUBLE PRECISION NOT NULL,
  "rawPnl" DOUBLE PRECISION NOT NULL,
  "adminLevyPercent" DOUBLE PRECISION NOT NULL,
  "adminLevy" DOUBLE PRECISION NOT NULL,
  "realizedPnl" DOUBLE PRECISION NOT NULL,
  "balanceBefore" DOUBLE PRECISION NOT NULL,
  "balanceAfter" DOUBLE PRECISION NOT NULL,
  "closeReason" TEXT NOT NULL,
  "marketDataSource" TEXT NOT NULL,
  "marketObservedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaperTradeSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "paper_settlement_levy_percent_range" CHECK ("adminLevyPercent" >= 0 AND "adminLevyPercent" <= 100),
  CONSTRAINT "paper_settlement_levy_nonnegative" CHECK ("adminLevy" >= 0)
);

CREATE UNIQUE INDEX "PaperTradeSettlement_closeOrderId_key"
  ON "PaperTradeSettlement"("closeOrderId");

CREATE UNIQUE INDEX "PaperTradeSettlement_positionId_key"
  ON "PaperTradeSettlement"("positionId");

CREATE INDEX "PaperTradeSettlement_userId_idx"
  ON "PaperTradeSettlement"("userId");

CREATE INDEX "PaperTradeSettlement_accountId_idx"
  ON "PaperTradeSettlement"("accountId");

CREATE INDEX "PaperTradeSettlement_botId_idx"
  ON "PaperTradeSettlement"("botId");
