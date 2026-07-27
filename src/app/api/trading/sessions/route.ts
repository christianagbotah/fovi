import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

interface SessionDef {
  id: string;
  name: string;
  open: string; // HH:mm UTC
  close: string; // HH:mm UTC
  utcOffset: number;
}

const SESSIONS: SessionDef[] = [
  { id: 'london', name: 'London', open: '08:00', close: '16:00', utcOffset: 0 },
  { id: 'newyork', name: 'New York', open: '13:30', close: '20:00', utcOffset: -5 },
  { id: 'asia', name: 'Asia', open: '00:00', close: '08:00', utcOffset: 8 },
];

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInRange(nowUtcMinutes: number, openMin: number, closeMin: number): boolean {
  if (openMin === closeMin) return false;
  if (openMin < closeMin) {
    return nowUtcMinutes >= openMin && nowUtcMinutes < closeMin;
  }
  // Wraps past midnight
  return nowUtcMinutes >= openMin || nowUtcMinutes < closeMin;
}

function buildSessionStatus() {
  // Africa/Accra is UTC+0, so we can use UTC directly.
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const sessions = SESSIONS.map((s) => {
    const openMin = parseHHMM(s.open);
    const closeMin = parseHHMM(s.close);
    const active = isInRange(utcMinutes, openMin, closeMin);
    return {
      ...s,
      status: active ? 'active' : 'closed',
      openUtc: s.open,
      closeUtc: s.close,
      minutesUntilOpen: active ? 0 : (openMin - utcMinutes + 1440) % 1440,
      minutesUntilClose: active ? (closeMin - utcMinutes + 1440) % 1440 : 0,
    };
  });

  // Current session = the most recently opened active one (priority NY > London > Asia)
  const priority = ['newyork', 'london', 'asia'];
  const activeSessions = sessions.filter((s) => s.status === 'active');
  const current =
    activeSessions.sort(
      (a, b) => priority.indexOf(a.id) - priority.indexOf(b.id),
    )[0]?.name ||
    (utcMinutes < 480 ? 'Asia' : utcMinutes < 960 ? 'London' : 'New York');

  return {
    currentSession: current,
    timezone: 'Africa/Accra',
    utcOffsetMinutes: 0,
    serverTime: now.toISOString(),
    sessions,
  };
}

export async function GET() {
  // Sessions are derived purely from server time, so they don't depend on db.
  // We still touch db to honor the project's import convention and to allow
  // future persistence of custom session overrides.
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(buildSessionStatus());
  }
  try {
    return NextResponse.json(buildSessionStatus());
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[sessions GET] DB error, using fallback:', error);
    return NextResponse.json(buildSessionStatus());
  }
}
