# Task 2-a: OKX Broker Integration

**Agent:** fullstack-developer
**Date:** 2025-01-XX
**Status:** ✅ Complete

## Summary

Implemented full OKX exchange broker integration for the Fovi AI auto-trading platform.
OKX is now a first-class broker option alongside Alpaca, Binance, Deriv, and the built-in
Demo broker. The implementation follows the same `IBroker` interface and HMAC-SHA256
signing pattern as Binance, with OKX-specific adaptations (Base64 signatures, passphrase,
`x-simulated-trading` header for demo mode, OKX instId symbol format).

## Files Created

### `src/lib/broker/okx.ts` (NEW — 350 lines)

Implements `OkxBroker` class conforming to the `IBroker` interface.

**Authentication — HMAC-SHA256 signing (Web Crypto API):**
- Prehash string: `timestamp + METHOD + requestPath + body`
- Signature: `base64(HMAC-SHA256(secret, prehash))` — OKX uses Base64 (unlike Binance which uses hex)
- Headers: `OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-TIMESTAMP`, `OK-ACCESS-PASSPHRASE`

**Demo mode:**
- Activated via the `x-simulated-trading: 1` header on every request
- The base URL `https://www.okx.com/api/v5` stays the same in demo mode (per OKX docs)
- *Note:* The task instruction mentioned using a `/demo/trading` URL prefix, but OKX's
  actual demo-trading mechanism is the header (the URL prefix would 404). Implemented
  the correct, documented approach with an explanatory code comment.

**Passphrase handling:**
- OKX requires an API passphrase in addition to key/secret
- Accepts it via `config.passphrase` (new optional field on `BrokerConfig`)
- Also accepts it encoded as `secret|passphrase` in `apiSecret` — this allows the existing
  DB schema (which only has `apiKey` + `apiSecret` columns) to be reused without migration

**Endpoints:**
| Method | Path                | Auth   | IBroker method    |
|--------|---------------------|--------|-------------------|
| GET    | `/account/balance`  | signed | `getAccountInfo`  |
| GET    | `/account/positions`| signed | `getPositions`    |
| POST   | `/trade/order`      | signed | `placeOrder`      |
| GET    | `/market/candles`   | public | `getCandles`      |
| GET    | `/market/ticker`    | public | `getPrice`        |

**Timeframe mapping** (our format → OKX bar):
`1m→1m, 3m→3m, 5m→5m, 15m→15m, 30m→30m, 1h→1H, 4h→4H, 1d→1D, 1w→1W`

**Symbol conversion:**
- `toOkxInstId`: `BTCUSDT` → `BTC-USDT` (handles USDT, USDC, USD, BTC, ETH quote currencies)
- `fromOkxInstId`: `BTC-USDT` → `BTCUSDT`

**Response parsing:** OKX wraps all responses in `{ code, msg, data }`. The `signedRequest`
helper unwraps and throws `OkxError` when `code !== '0'`.

**Order types:** `market→market`, `limit→limit`, `stop→conditional`, `stop_limit→conditional`
(OKX uses `conditional` for stop-loss orders). Spot trading uses `tdMode=cash`.

**Position side detection:** Handles OKX's `posSide` field (`long`/`short`/`net`) and the
sign of `pos` in net mode.

**Custom error class:** `OkxError` with `statusCode` and `path` fields, mirroring `BinanceError`.

## Files Modified

### `src/lib/broker/factory.ts`
- Imported `OkxBroker` from `./okx`
- Added `case 'okx': return new OkxBroker(config);` to the `createBroker` switch

### `src/lib/types.ts`
- Added `'okx'` to the `BrokerProvider` union type
- Added optional `passphrase?: string` field to `BrokerConfig` (with JSDoc explaining its
  purpose and the `secret|passphrase` fallback encoding)

### `src/components/trading/account-switcher.tsx`
- Added `Landmark` icon to the lucide-react import
- Added OKX option to the broker `Select` dropdown:
  ```tsx
  <SelectItem value="okx">
    <span className="flex items-center gap-2"><Landmark className="h-4 w-4" /> OKX (Crypto)</span>
  </SelectItem>
  ```

### `src/app/page.tsx` (SettingsSheet → "Connect Broker" section)
- Added `'okx'` to the broker buttons array
- Changed the grid layout from `grid-cols-3` to `grid-cols-2` so the 4 brokers display
  cleanly in a 2x2 grid (the previous 3-column layout would have left OKX awkwardly
  wrapping to a second row)

## Verification

- ✅ `bun run lint` — passes with no errors or warnings
- ✅ Dev server compiles `/` route successfully (`GET / 200`)
- ✅ TypeScript types are consistent across the broker interface, factory, and consumers
- ✅ OKX broker follows the exact `IBroker` contract used by Alpaca/Binance/Demo

## Notes for Downstream Tasks

1. **DB schema for passphrase:** The current `TradingAccount` Prisma model only has
   `apiKey` + `apiSecret` columns. Users must encode the OKX passphrase as
   `secret|passphrase` in the apiSecret field. A cleaner approach would be to add a
   `passphrase` column to the schema and surface it in the SettingsSheet UI — that
   work is out of scope for this task.

2. **Order fill sync:** `placeOrder` returns `status: 'pending'` because OKX's
   POST /trade/order response only contains `ordId` (no fill details). A follow-up
   task could implement GET /trade/order polling to sync fill state, mirroring the
   pattern used by the Alpaca broker.

3. **Spot vs derivatives:** The current implementation uses `tdMode=cash` (spot) for
   all orders. To support OKX futures/swap trading, the `tdMode` would need to be
   configurable (e.g. `isolated`, `cross`) per account, and the close-position logic
   would need to send `posSide` for long/short direction.

4. **OKX rate limits:** OKX has per-endpoint rate limits (e.g. 20 req/2s for trading,
   6 req/s for market data). The current implementation does no client-side throttling.
   If Fovi scales to high-frequency trading, a rate limiter should be added.

## Files Touched

```
src/lib/broker/okx.ts                              (NEW, 350 lines)
src/lib/broker/factory.ts                          (modified — 2 edits)
src/lib/types.ts                                   (modified — 2 edits)
src/components/trading/account-switcher.tsx        (modified — 2 edits)
src/app/page.tsx                                   (modified — 1 edit)
```
