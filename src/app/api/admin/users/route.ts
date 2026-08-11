import { NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

// GET: list all users (admin only)
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('user')) {
      return NextResponse.json({ users: [] });
    }

    const users = await safeDbQuery(() =>
      db!.user.findMany({
        select: { id: true, email: true, name: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    );

    return NextResponse.json({ users: users || [] });
  } catch (err) {
    console.error('[Admin Users] Failed to list:', err);
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 });
  }
}
