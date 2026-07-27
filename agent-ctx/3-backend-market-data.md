# Task 3: Backend Market Data — CoinGecko Production API Integration

**Agent:** Backend Market Data Expert
**Date:** 2025-01-XX
**Status:** ✅ Complete

## Summary

Replaced simulated/demo market data with real production CoinGecko API data for all 10 crypto symbols (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, DOT, LINK). Stocks, forex, and commodities continue using the demo random-walk system. All CoinGecko calls are wrapped in try/catch with seamless fallback to demo data — the app never breaks when CoinGecko is unavailable.

## Files Modified

### `mini-services/market-service/index.ts` (primary change)

**Added CoinGecko real crypto data integration:**

1. **Top comment**: `// Crypto prices from CoinGecko API (free, no key). Stocks/forex use demo data. On VPS, add TWELVEDATA_API_KEY env var for real stock data.`

2. **`COINGECKO_IDS` mapping**: Maps our 10 crypto symbols to CoinGecko coin IDs (`BTC→bitcoin`, `ETH→ethereum`, etc.)

3. **`fetchRealCryptoPrices()` function**: 
   - Calls `https://api.coingecko.com/api/v3/coins/markets` with `vs_currency=usd&per_page=20&page=1&price_change_percentage=24h`
   - Uses `AbortSignal.timeout(10_000)` for 10s timeout
   - Parses response into a `Map<string, { price, change, changePercent, volume, high24h, low24h }>`
   - Only overwrites `realCryptoPrices` if at least 1 valid price was fetched
   - On failure: logs warning, keeps previous prices (or empty if first call fails)
   - Called on startup and every 30 seconds via `setInterval`

4. **Enhanced `getPriceTick()` function**:
   - First checks `realCryptoPrices.get(symbol)` for crypto symbols
   - If real data exists: returns real price with a tiny `±0.05%` micro-movement to simulate live tick fluctuations
   - If no real data (CoinGecko down, or non-crypto symbol): falls back to original `randomWalkPrice` demo logic
   - All other fields (name, assetType, volume, high24h, low24h) come from real data when available

5. **30-second refresh loop**: `setInterval(() => { fetchRealCryptoPrices() }, 30_000)` — stays within CoinGecko free tier rate limits (~10-30 calls/min)

6. **Startup sequence changed**: Server now calls `fetchRealCryptoPrices().then(() => httpServer.listen(PORT, ...))` so real prices are available before the first client connects

**Preserved unchanged:**
- All socket.io event names (`prices:update`, `price:update`, `market:subscribe`, etc.)
- `PriceTick` interface shape (fully compatible)
- `BASE_PRICES`, `SYMBOL_NAMES`, `getAssetType()`, `randomWalkPrice()` for demo fallback
- 2-second broadcast interval
- Connection/disconnection handlers
- Port 3003

### `src/app/api/trading/market/symbols/route.ts` (already had CoinGecko)

This file already contained a complete CoinGecko integration from a prior task:
- `COINGECKO_IDS` mapping with 30s in-memory cache
- `fetchCryptoSymbols()` — CoinGecko `/coins/markets` endpoint
- `fetchCryptoCandles()` — CoinGecko `/coins/{id}/ohlc` endpoint with timeframe-to-days mapping
- `fetchStockSymbols()` — hook for future TwelveData API integration
- Route handler merges real crypto into demo symbol list with `_realData: true/false` flags
- All CoinGecko calls wrapped in try/catch with demo fallback

No changes needed to this file — it was already production-ready.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           mini-services/market-service          │
│                  (port 3003)                     │
│                                                 │
│  Startup & every 30s:                          │
│    fetchRealCryptoPrices() → CoinGecko API      │
│       ↓ success: update realCryptoPrices Map    │
│       ↓ failure: keep existing / use demo       │
│                                                 │
│  Every 2s broadcast:                            │
│    getPriceTick(symbol)                          │
│      → crypto + has real data? → real price      │
│      → else → randomWalkPrice (demo fallback)   │
│                                                 │
│    io.to('market:all').emit('prices:update', …) │
│    io.to('market:BTC').emit('price:update', …)  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│      src/app/api/trading/market/symbols         │
│              (Next.js API route)                 │
│                                                 │
│  GET ?symbol=BTC&timeframe=1d&limit=100         │
│    → fetchCryptoCandles() → CoinGecko OHLC     │
│    → fallback: getDemoCandles()                 │
│                                                 │
│  GET (no symbol param)                          │
│    → fetchCryptoSymbols() → CoinGecko markets  │
│    → merge into getAllDemoSymbols()             │
│    → each symbol tagged _realData: true/false   │
└─────────────────────────────────────────────────┘
```

## Data Flow

- **WebSocket clients** receive price ticks every 2s. Crypto symbols get real CoinGecko prices (with micro-movement). Stocks/forex/commodities get demo random-walk.
- **REST clients** calling `/api/trading/market/symbols` get the merged list with `_realData` flags.
- **REST clients** calling `/api/trading/market/symbols?symbol=BTC` get real OHLC candles from CoinGecko (or demo fallback).

## Rate Limit Considerations

- CoinGecko free tier: ~10-30 calls/min
- Market service: 1 call every 30s = ~2 calls/min (well within limits)
- REST API route: 30s in-memory cache prevents duplicate calls
- `AbortSignal.timeout(10s)` prevents hung connections

## Verification

- ✅ `git add -A && git commit && git push` — committed as `17470ed`
- ✅ All socket.io event names and message formats preserved
- ✅ `PriceTick` interface unchanged (backward compatible)
- ✅ CoinGecko failures never break the app (try/catch + demo fallback)
- ✅ 30s cache TTL for REST API, 30s refresh interval for WebSocket service

## Files Touched

```
mini-services/market-service/index.ts          (modified — CoinGecko integration + 30s refresh)
src/app/api/trading/market/symbols/route.ts    (no change — already had CoinGecko)
```
