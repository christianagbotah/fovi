import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { verifyPassword, generateAccessToken } from '@/lib/auth';
import {
  createAuthSession,
  readRefreshCookie,
  revokeAuthSessionFamily,
  setRefreshCookie,
} from '@/lib/auth-sessions';
import { authJson } from '@/lib/auth-response';
import { issueTwoFactorChallenge } from '@/lib/two-factor-challenges';
import {
  clearSigninFailures,
  getSigninAbuseStatus,
  recordSigninFailure,
  type SigninAbuseStatus,
} from '@/lib/auth-abuse';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const signinSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  rememberMe: z.boolean().optional().default(false),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'signin' });

function abuseBlockedResponse(status: SigninAbuseStatus) {
  const retryAfterMs = status.locked ? status.retryAfterMs : 60_000;
  return authJson(
    { error: status.available ? 'Too many sign-in attempts. Please try again later.' : 'Authentication service unavailable.' },
    {
      status: status.available ? 429 : 503,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
        { error: 'Too many sign-in attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = signinSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, rememberMe } = parsed.data;
    const emailLower = email.toLowerCase().trim();

    if (isDbAvailable() && db && hasModel('user')) {
      const abuseStatus = await getSigninAbuseStatus(emailLower);
      if (!abuseStatus.available || abuseStatus.locked) {
        return abuseBlockedResponse(abuseStatus);
      }

      const user = await safeDbQuery(() =>
        db!.user.findUnique({
          where: { email: emailLower },
          include: {
            settings: {
              select: {
                twoFactorEnabled: true,
              },
            },
          },
        })
      );

      if (!user || !user.passwordHash) {
        const failed = await recordSigninFailure(emailLower);
        if (!failed.available || failed.locked) return abuseBlockedResponse(failed);
        return authJson(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      const valid = verifyPassword(password, user.passwordHash);
      if (!valid) {
        const failed = await recordSigninFailure(emailLower);
        if (!failed.available || failed.locked) return abuseBlockedResponse(failed);
        return authJson(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      if (!user.isActive) {
        return authJson(
          { error: 'Account is deactivated' },
          { status: 403 }
        );
      }

      if (!(await clearSigninFailures(emailLower))) {
        return authJson(
          { error: 'Authentication service unavailable.' },
          { status: 503 }
        );
      }

      if (user.settings?.twoFactorEnabled) {
        const issuedChallenge = await issueTwoFactorChallenge(user.id, user.email);
        if (!issuedChallenge) {
          return authJson(
            { error: 'Two-factor challenge service unavailable.' },
            { status: 503 },
          );
        }
        return authJson({
          success: true,
          requiresTwoFactor: true,
          twoFactorChallenge: issuedChallenge.token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }

      const existingRefreshToken = readRefreshCookie(request);
      if (existingRefreshToken) {
        await revokeAuthSessionFamily(existingRefreshToken, 'REAUTHENTICATED');
      }

      let session;
      try {
        session = await createAuthSession(user.id, rememberMe);
      } catch {
        return authJson(
          { error: 'Authentication session service unavailable.' },
          { status: 503 }
        );
      }

      const isAdmin = process.env.ADMIN_EMAIL && emailLower === process.env.ADMIN_EMAIL.toLowerCase();
      const token = await generateAccessToken(user.id, user.email, user.name || undefined, isAdmin ? 'admin' : undefined);

      const response = authJson({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        token,
      });
      setRefreshCookie(response, session);
      return response;
    }

    // Local/demo authentication is opt-in and MUST never become a production
    // fallback when the database is missing or unavailable. Demo auth does not
    // receive a persistent refresh session.
    const allowDemoAuth = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_AUTH === 'true';
    if (allowDemoAuth && emailLower === 'demo@fovi.ai' && password === 'password123') {
      const token = await generateAccessToken('demo-user', 'demo@fovi.ai', 'Demo User');
      return authJson({
        success: true,
        user: {
          id: 'demo-user',
          email: 'demo@fovi.ai',
          name: 'Demo User',
        },
        token,
      });
    }

    return authJson(
      { error: 'Authentication service unavailable.' },
      { status: 503 }
    );
  } catch {
    return authJson(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
