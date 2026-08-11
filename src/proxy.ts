import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /api/trading/* and /api/admin/* routes
  if (!pathname.startsWith('/api/trading/') && !pathname.startsWith('/api/admin/')) {
    return NextResponse.next();
  }

  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 }
    );
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid or expired token.' },
      { status: 401 }
    );
  }

  // Admin routes require admin role
  if (pathname.startsWith('/api/admin/') && payload.type === 'access' && payload.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('X-User-Id', payload.sub);
  if (payload.type === 'access' && 'email' in payload) {
    requestHeaders.set('X-User-Email', (payload as { email: string }).email);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}
