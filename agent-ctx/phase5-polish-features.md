---
Task ID: 5.1-5.5
Agent: phase5-polish
Task: Email verification, token refresh, order cancellation, persist demo SL/TP, auto-create demo account

Work Log:

**5.1 Email Verification on Signup**
- Added `emailVerified Boolean @default(false)`, `emailVerifyToken String?`, `emailVerifyExpiry DateTime?` to User model in `prisma/schema.prisma`
- Created `src/app/api/auth/verify-email/route.ts` — POST endpoint that verifies a token (hashed lookup, 1h expiry check), sets `emailVerified=true`, clears token fields. Rate limited 10/min.
- Updated `src/app/api/auth/signup/route.ts` — After user creation, generates 32-byte hex verification token, hashes and stores in `emailVerifyToken` + `emailVerifyExpiry`, sends verification email via `sendEmail()` (fire-and-forget).
- Created `src/app/api/auth/resend-verification/route.ts` — POST endpoint accepting `{ email }`, re-generates token, re-sends email. Rate limited 3/min. Does not reveal if email exists.

**5.2 Token Refresh Endpoint**
- Created `src/app/api/auth/refresh/route.ts` — POST `{ refreshToken }`, verifies JWT is type='refresh', generates new access (24h) + new refresh (7d) tokens (rotation). Rate limited 10/min.
- Added `/api/auth/refresh` to `PUBLIC_PATHS` in `src/middleware.ts`

**5.3 Order Cancellation API**
- Added `cancelOrder(symbol: string, orderId: string): Promise<void>` to `IBroker` interface in `src/lib/broker/factory.ts`
- Implemented in all 4 brokers:
  - `binance.ts` — DELETE `/api/v3/order` with HMAC-SHA256 signed query params
  - `okx.ts` — POST `/trade/cancel-order` with instId+ordId JSON body, HMAC-SHA256 signed
  - `alpaca.ts` — DELETE `/v2/orders/{orderId}` with API key headers
  - `demo.ts` — no-op (demo orders fill immediately)
- Created `src/app/api/trading/orders/[id]/route.ts` — DELETE handler that finds order by ID, verifies ownership via account userId, checks status is pending/partially_filled, calls broker.cancelOrder, updates DB status to 'cancelled'

**5.4 Persist Demo SL/TP to DB**
- Updated `src/app/api/trading/positions/route.ts` GET:
  - Detects demo accounts, loads in-memory SL/TP map
  - On upsert/create positions, merges memory SL/TP into DB records
  - On read, returns DB-persisted SL/TP with in-memory overrides taking precedence
- Updated `src/app/api/trading/positions/[id]/route.ts` PATCH:
  - After DB update, checks if account is demo
  - If demo, calls `saveDemoPositionSLTP()` to also update in-memory store

**5.5 Auto-Create Demo Trading Account on Signup**
- Updated `src/app/api/auth/signup/route.ts`:
  - After creating User and UserSettings, checks `hasModel('tradingAccount')`
  - Creates a TradingAccount with broker='demo', balance=100000, isDefault=true
  - Wrapped in try/catch so signup doesn't fail if account creation fails

**Middleware updates**
- Added `/api/auth/verify-email` and `/api/auth/resend-verification` to PUBLIC_PATHS
- Added `/api/auth/refresh` to PUBLIC_PATHS

Stage Summary:
- 5 features fully implemented, all linting clean
- Schema changes ready (emailVerified, emailVerifyToken, emailVerifyExpiry on User model)
- 3 new API routes: verify-email, resend-verification, refresh
- 1 new API route: orders/[id] DELETE for order cancellation
- IBroker interface extended with cancelOrder, all 4 brokers implement it
- Demo SL/TP now persisted to DB with in-memory override precedence
- New users auto-get a demo trading account with $100k balance