import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const bearerToken = extractBearerToken(request);
    const token = bearerToken || request.nextUrl.searchParams.get('token') || '';

    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.type !== 'access') {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
      expiresAt: payload.exp,
    });
  } catch {
    return NextResponse.json({ error: 'Token validation failed' }, { status: 401 });
  }
}
