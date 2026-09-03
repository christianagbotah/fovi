import { NextRequest } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';

export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request);

    if (!token) {
      return authJson({ error: 'No token provided' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.type !== 'access') {
      return authJson({ error: 'Invalid or expired token' }, { status: 401 });
    }

    return authJson({
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
    return authJson({ error: 'Token validation failed' }, { status: 401 });
  }
}
