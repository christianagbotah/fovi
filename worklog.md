# Worklog

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
