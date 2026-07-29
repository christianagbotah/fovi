# Task 4-6: AI Trading Dashboard Enhancements

## Changes Made

### 1. Token Dropdown (Market Explorer)
- Added `Select` component from shadcn/ui at top of a new "Market Explorer" card
- Dropdown shows "Portfolio Overview" (default) + all 12 SYMBOL_DATA symbols
- When a symbol is selected, displays:
  - Simulated current price (formatted with correct decimals)
  - 24h change percentage (green/red colored)
  - Mini SVG line chart (50 candles from `getDemoCandles`)
  - Chart has gradient fill, green/red based on direction
- Prices update every 5 seconds via interval

### 2. Equity Curve Chart
- New "Equity Curve" card below hero card (only shown when allocation > 0)
- Pure SVG implementation (no external libraries)
- Tracks equity snapshots every time `simulateTrade()` runs
- Max 100 data points (FIFO)
- Green line when equity >= allocation, red when below
- Subtle gradient fill under the line
- Y-axis labels ($ values) on right side
- Dashed baseline at allocation level
- Dot indicator at latest point

### 3. Additional Detail Stats
- **Invested**: Sum of open position entry values
- **Available**: Equity minus invested amount
- **Best Trade**: Highest realized P&L from closed trades (Trophy icon)
- **Worst Trade**: Lowest realized P&L from closed trades
- **Current Streak**: Consecutive wins (Flame icon, emerald) or losses (Snowflake icon, red)
- **Total Levy Collected**: Sum of all admin levies

### Files Modified
- `src/components/trading/ai-trading-dashboard.tsx` — all 3 features added via targeted edits
- `worklog.md` — documented changes

### Imports Added
- `getDemoCandles` from `@/lib/broker/demo`
- `CandleData` type from `@/lib/types`
- `Select/SelectContent/SelectItem/SelectTrigger/SelectValue` from shadcn/ui
- `Flame`, `Snowflake`, `Trophy` from lucide-react

### State Added
- `selectedSymbol` (default `'__portfolio__'`)
- `miniCandles` (CandleData[])
- `equityHistory` (number[])
- `symbolPricesRef` (ref for simulated prices)

### Computed Values Added
- `bestTrade`, `worstTrade`, `currentStreak`

### Validation
- ESLint: 0 errors
- No JSX comments inside motion components (SWC/Turbopack safe)
- All existing functionality preserved