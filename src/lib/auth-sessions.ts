import { createHash, randomBytes, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';

export { isSameOriginMutation } from '@/lib/same-origin';

export const REFRESH_COOKIE_NAME = 'fovi_refresh';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshSecret(): string {
  return randomBytes(48).toString('base64url');
}

function sessionTtlMs(rememberMe: boolean): number {
  return rememberMe ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS;
}

export type IssuedAuthSession = {
  refreshToken: string;
  expiresAt: Date;
  rememberMe: boolean;
};

export type RotatedAuthSession =
  | {
      status: 'ok';
      refreshToken: string;
      expiresAt: Date;
      rememberMe: boolean;
      user: { id: string; email: string; name: string | null; isActive: boolean };
    }
  | { status: 'invalid' }
  | { status: 'reused' }
  | { status: 'inactive' }
  | { status: 'unavailable' };

function authSessionModelAvailable(): boolean {
  return isDbAvailable() && !!db && hasModel('authSession');
}

export async function createAuthSession(userId: string, rememberMe: boolean): Promise<IssuedAuthSession> {
  if (!authSessionModelAvailable() || !db) {
    throw new Error('AUTH_SESSION_STORE_UNAVAILABLE');
  }

  const refreshToken = generateRefreshSecret();
  const expiresAt = new Date(Date.now() + sessionTtlMs(rememberMe));

  await db.authSession.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: hashRefreshToken(refreshToken),
      rememberMe,
      expiresAt,
    },
  });

  return { refreshToken, expiresAt, rememberMe };
}

export async function rotateAuthSession(refreshToken: string): Promise<RotatedAuthSession> {
  if (!authSessionModelAvailable() || !db) {
    return { status: 'unavailable' };
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: { id: true, email: true, name: true, isActive: true },
          },
        },
      });

      if (!session) {
        return { status: 'invalid' as const };
      }

      if (session.revokedAt) {
        if (session.revokeReason === 'ROTATED') {
          await tx.authSession.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now, revokeReason: 'REUSE_DETECTED' },
          });
          return { status: 'reused' as const };
        }
        return { status: 'invalid' as const };
      }

      if (session.expiresAt.getTime() <= now.getTime()) {
        await tx.authSession.update({
          where: { id: session.id },
          data: { revokedAt: now, revokeReason: 'EXPIRED', lastUsedAt: now },
        });
        return { status: 'invalid' as const };
      }

      if (!session.user.isActive) {
        await tx.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'ACCOUNT_INACTIVE' },
        });
        return { status: 'inactive' as const };
      }

      // Compare-and-swap the active token. If another request already rotated
      // it, treat this token as reused and revoke the remaining active family.
      const rotation = await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'ROTATED', lastUsedAt: now },
      });

      if (rotation.count !== 1) {
        await tx.authSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'REUSE_DETECTED' },
        });
        return { status: 'reused' as const };
      }

      const nextRefreshToken = generateRefreshSecret();
      await tx.authSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: hashRefreshToken(nextRefreshToken),
          rememberMe: session.rememberMe,
          expiresAt: session.expiresAt,
        },
      });

      return {
        status: 'ok' as const,
        refreshToken: nextRefreshToken,
        expiresAt: session.expiresAt,
        rememberMe: session.rememberMe,
        user: session.user,
      };
    });
  } catch {
    return { status: 'unavailable' };
  }
}

export async function revokeAuthSessionFamily(refreshToken: string, reason = 'LOGOUT'): Promise<void> {
  if (!authSessionModelAvailable() || !db) return;

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { tokenHash },
        select: { familyId: true },
      });
      if (!session) return;

      await tx.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      });
    });
  } catch {
    // Logout remains idempotent even if the session store is temporarily down.
  }
}

export function readRefreshCookie(request: NextRequest): string | null {
  return request.cookies.get(REFRESH_COOKIE_NAME)?.value || null;
}

export function setRefreshCookie(response: NextResponse, session: IssuedAuthSession): void {
  const maxAge = session.rememberMe
    ? Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))
    : undefined;

  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: session.refreshToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    ...(maxAge ? { maxAge } : {}),
  });
}

export function clearRefreshCookie(response: NextResponse): void {
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 0,
  });
}
