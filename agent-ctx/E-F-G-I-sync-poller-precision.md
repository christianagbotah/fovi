---
Task ID: E-F-G-I
Agent: sync-poller-precision
Task: Balance sync service, Binance precision, broker rate limiter

Work Log:
- Created `mini-services/balance-sync/package.json` and `mini-services/balance-sync/index.ts`
- Created `src/lib/broker/binance-exchange-info.ts` for LOT_SIZE/PRICE_FILTER precision
- Updated `src/lib/broker/binance.ts` to use async formatQty/formatPrice from exchange info
- Created `src/lib/broker-rate-limit.ts` with per-broker minimum intervals
- Added `brokerRateLimit()` calls to all public methods in binance.ts, okx.ts, alpaca.ts
- Balance-sync service running on port 3011, verified health/sync/status endpoints
- Lint passes cleanly

Stage Summary:
- Balance sync service polls PostgreSQL for non-demo accounts, calls Next.js APIs every 5 min
- Binance qty/price formatting now uses real step size/tick size from exchangeInfo API
- All broker clients enforce rate limits: Binance 500ms, OKX 200ms, Alpaca 250ms
