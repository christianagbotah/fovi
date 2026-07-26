# Worklog

---
Task ID: 4
Agent: main
Task: Fix VPS "Loading terminal" crash - AI chat SDK fallback, portable DB path

Work Log:
- Diagnosed VPS crash: PM2 logs showed PrismaClientInitializationError (postgresql provider) and z-ai-web-dev-sdk connection refused
- Found schema.prisma already had provider=sqlite (was fixed in prior session but not pulled to VPS)
- Rewrote AI chat route (src/app/api/trading/ai-chat/route.ts):
  - Lazy ZAI SDK initialization with try/catch
  - If SDK init fails (unreachable from VPS), sets zaiInitFailed flag
  - Provides offline fallback responses with market context and technical analysis
  - SDK failure no longer crashes the route — returns 200 with offline indicator
- Changed DATABASE_URL from absolute path to relative `file:./dev.db` for VPS portability
- Optimized Prisma db.ts: query logging only in development, disabled in production
- Added .env.example template for VPS deployment reference
- Updated .gitignore to allow .env.example, block tool-results/ and prisma/*.db
- Ran prisma generate, prisma db push (new DB at prisma/dev.db)
- Ran `bun run build` — successful, all 13 routes compiled
- Dev server starts, page compiles, GET / returns 200
- Committed and pushed to GitHub (7b3eed5)

Stage Summary:
- Root VPS issue: VPS was running old code with postgresql provider in schema.prisma
- AI chat now degrades gracefully to offline mode when z-ai-web-dev-sdk is unreachable
- DATABASE_URL is portable (file:./dev.db) — works on any machine
- User needs to: git pull, set .env, prisma generate, prisma db push, rebuild, restart PM2
---
Task ID: 3
Agent: main
Task: Fix login - replace all React-based approaches with pure HTML Route Handler

Work Log:
- Diagnosed root cause: React hydration fails on VPS, making server actions unusable
- Client-side fetch("/api/auth/csrf") fails on VPS (button stuck)
- Cookie forwarding via getSetCookie() fails because Bun's redirect:"manual" returns opaque response (per Fetch spec)
- Cookie forwarding via manual Set-Cookie header appending also failed (unknown runtime issue)
- Server Actions require React hydration to intercept form submissions — fails on VPS

- Solution: Pure HTML Route Handler at /auth/signin/route.ts
  - GET: returns pure HTML page (no React, no hydration needed)
  - POST: authenticates directly using findUserForAuth() + verifyPassword()
  - Creates JWT using jose SignJWT with NEXTAUTH_SECRET (same lib NextAuth uses)
  - Sets session cookie via standard Set-Cookie header on redirect response
  - No CSRF needed (no NextAuth callback)
  - No cookie forwarding (we create the JWT ourselves)
  - Modal overlay via 4 lines of vanilla JS

- Deleted: page.tsx (React server component), actions.ts (server action)
- Pushed commit to GitHub

Stage Summary:
- This approach has ZERO dependencies on React, NextAuth callback, or cookie forwarding
- The JWT is created by the same library (jose) with the same secret NextAuth uses
- getServerSession() will validate the JWT correctly because it's properly signed
- If this still fails, the issue is with nginx/Cloudflare stripping Set-Cookie headers
- PM2 logs will show [signin] entries for diagnostics
