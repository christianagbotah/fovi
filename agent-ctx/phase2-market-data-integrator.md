# Phase 2 — Real Market Data Integration

## Task
Integrate real market data for ALL asset types (stocks, forex, commodities, indices, crypto).

## Files Created/Modified

### Created
- `src/lib/market-data.ts` — Unified market data service

### Modified
- `src/app/api/trading/market/symbols/route.ts` — Uses market-data.ts for all asset types
- `src/components/trading/order-form.tsx` — Uses livePrices from store instead of getDemoPrice
- `mini-services/market-service/index.ts` — Real API calls for forex, metals, stocks

## Data Sources
| Asset Type | API | Frequency | Key Required |
|-----------|-----|-----------|-------------|
| Crypto | CoinGecko | 30s | No |
| Forex | ExchangeRate-API | 60s | No |
| Metals (Gold/Silver) | metals.live | 60s | No |
| Stocks/Indices | Finnhub | 5min | Yes (FINNHUB_API_KEY) |

## Key Design Decisions
- All API calls have try/catch with graceful demo fallback
- App works 100% without any API keys (demo mode)
- Memory caching with per-source TTL
- WebSocket broadcast uses cached data (no API calls in 2s loop)
- Order form reads from livePrices WebSocket data, not demo function