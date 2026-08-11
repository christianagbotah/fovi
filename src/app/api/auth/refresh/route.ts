import { NextRequest, NextResponse } from 'next/server';
import { generateAccessToken, generateRefreshToken, verifyToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'token-refresh' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { refreshToken } = parsed.data;

    // Verify the refresh token
    const payload = await verifyToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired refresh token' },
        { status: 401 }
      );
    }

    if (payload.type !== 'refresh') {
      return NextResponse.json(
        { error: 'Invalid token type. Expected refresh token.' },
        { status: 401 }
      );
    }

    // Generate new access token (24h) + new refresh token (7d) — rotation
    const userId = payload.sub;
    const newAccessToken = await generateAccessToken(userId, payload.email || '', payload.name);
    const newRefreshToken = await generateRefreshToken(userId);

    return NextResponse.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
