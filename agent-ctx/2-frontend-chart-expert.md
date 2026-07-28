# Task 2: Price Chart — Area / Candlestick / Line Chart Types

**Agent:** Frontend Chart Expert
**Date:** 2025-01-XX
**Status:** ✅ Complete

## Summary

Verified, refined, and committed the `PriceChart` component supporting three chart types:
**Area**, **Candlestick**, and **Line** — with a chart type toggle selector, volume bars,
and full mobile responsiveness.

The base implementation was already present (345 lines) from a prior pass. This agent
reviewed against all 12 requirements and applied two targeted fixes:

1. **`cursor-pointer` class** added to chart type toggle buttons (requirement §2)
2. **CandlestickShape fallback** corrected from `background?.height || height` to
   `background?.height || 300` per the spec (requirement §3)

## Requirements Checklist

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Three chart types (`area`, `candle`, `line`) via `useState<ChartType>('area')` | ✅ |
| 2 | Chart type selector UI — icons-only on mobile, icons+text on desktop (`hidden lg:inline`), active=`bg-primary text-primary-foreground`, inactive=`text-muted-foreground hover:bg-accent`, `cursor-pointer` | ✅ (fixed `cursor-pointer`) |
| 3 | Candlestick via `ComposedChart` + custom `CandlestickShape`, green (#10b981) up / red (#ef4444) down, wick+body, tooltip shows OHLC | ✅ (fixed fallback `300`) |
| 4 | Line chart via `LineChart` + `Line`, stroke green/red, strokeWidth 2, dot={false} | ✅ |
| 5 | Area chart with gradient fill | ✅ |
| 6 | Volume bar chart at bottom (green/red in candle mode) | ✅ |
| 7 | Correct recharts imports | ✅ |
| 8 | Lucide icons with aliases (AreaChartIcon, BarChart3, LineChartIcon, ArrowUpRight, ArrowDownRight) | ✅ |
| 9 | Header (symbol, price, buy/sell), timeframe selector, loading state | ✅ |
| 10 | useTradingStore for all required state/actions | ✅ |
| 11 | formatPrice from `@/lib/market-sim` | ✅ |
| 12 | CandleData type from `@/lib/types` (used via CandleData[] in store) | ✅ |

## Files Modified

- `src/components/trading/price-chart.tsx` — 2 line edits (cursor-pointer, background fallback)

## Verification

- ✅ `bun run lint` — 0 errors, 0 warnings
- ✅ Git commit: `a741693 feat: rebuild price-chart with area/candlestick/line chart types`
- ✅ Git push: `main -> main` (aab237e..a741693)
