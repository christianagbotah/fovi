## CRITICAL PROJECT CONFIGURATION

- **Production VPS**: fovi.lightworldtech.com
- **Production Port**: **3002** (NOT 3000 — port 3000 is reserved for a different app)
- **Process Manager**: PM2 (`pm2 restart fovi-app`)
- **Start Command**: `npx next dev -p 3002`
- **Local Dev**: For local sandbox testing, port 3000 may be used since it's the only available port, but NEVER deploy or configure for port 3000 on the VPS.

---
Task ID: 1
Agent: Main Agent
Task: Fix build errors in ai-trading-dashboard.tsx and page.tsx

Work Log:
- Fixed malformed JSX comment on page.tsx line 1275 (missing closing `}` and corrupted XML tags from previous edit tool issue)
- Rewrote entire ai-trading-dashboard.tsx to fix SWC/Turbopack parsing errors with nested ternary expressions containing JSX elements
- Replaced all `condition ? <JSX /> : <JSX />` patterns with helper functions (renderStatusIcon, renderSideIcon, renderPnlBadge)
- Replaced all template literal className conditionals with string concatenation to avoid SWC parser confusion
- Verified lint passes cleanly with no errors
- Verified dev server starts and page loads with HTTP 200

Stage Summary:
- Both files compile without errors
- ai-trading-dashboard.tsx: ~430 lines, clean rewrite avoiding SWC-incompatible patterns
- page.tsx: corrupted comment fixed
- Dev server compiles and page renders successfully
- **IMPORTANT**: On VPS, always use port 3002, never 3000---
Task ID: 3
Agent: Main (Z.ai Code)
Task: Fix AI trading dashboard — allocation model, negative equity, stats not updating, admin levy, portfolio sync

Work Log:
- Diagnosed root causes: setBotConfig called with function instead of object (why totalTrades/winRate=0), random price simulation generating impossible prices, equity formula wrong (accountBalance - investedAmount), no allocation-based position sizing
- Updated trading-store.ts: Added adminLevyPercent (default 10%) and adminLevyCollected to BotConfigState; Added grossPnl and adminLevy fields to AIClosedTrade
- Complete rewrite of ai-trading-dashboard.tsx (~930 lines):
  - Realistic symbol-specific base prices (AAPL $198, BTC $68,500, EUR/USD 1.085, etc.)
  - Price simulation uses ±0.8% drift from current (never random jumps)
  - Position sizing = allocation / maxPositions / symbolPrice (each position uses equal fraction)
  - Equity = max(0, allocation + netRealizedPnl + unrealizedPnl) — can NEVER go negative
  - Auto-liquidation when equity hits 0 (all positions force-closed, status = 'liquidated')
  - setBotConfig now called with computed object (NOT function)
  - Admin levy: configurable % (default 10%) deducted from profitable trades
  - Trade history shows Gross P&L, Levy, Net P&L columns
  - Added reset button to clear all trade data
  - Added equity progress bar and available/invested balance display
  - Portfolio sync useEffect to update store's portfolio state
- Updated page.tsx PortfolioCards to derive values from AI trading state (botConfig, aiOpenPositions, aiClosedTrades) so dashboard tab stays in sync

Stage Summary:
- Files modified: src/lib/store/trading-store.ts, src/components/trading/ai-trading-dashboard.tsx, src/app/page.tsx
- Key fixes: negative equity eliminated, totalTrades/winRate now update correctly, realistic prices, admin levy system, portfolio dashboard sync
- No TS errors, no lint errors, page compiles (200 OK)
