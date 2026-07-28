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
- **IMPORTANT**: On VPS, always use port 3002, never 3000