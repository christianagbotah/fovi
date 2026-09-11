import { NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';

// GET: list all users (admin only)
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('user')) {
      return NextResponse.json(
        { error: 'User storage is unavailable.' },
        { status: 503 },
      );
    }

    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error('[Admin Users] Failed to list:', err);
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 503 });
  }
}