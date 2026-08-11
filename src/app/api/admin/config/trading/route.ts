import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, isDbAvailable, hasModel } from '@/lib/db';
import { getSystemConfig, saveSystemConfig } from '@/lib/system-config';

// ============================================================
// Defaults
// ============================================================

const DEFAULTS = {
  defaultAdminLevyPercent: 10,
  defaultMaxPositions: 5,
  defaultStopLossPercent: 2.0,
  defaultTakeProfitPercent: 4.0,
  defaultMaxPositionSizePercent: 20,
};

// ============================================================
// Zod schemas
// ============================================================

const tradingSchema = z.object({
  defaultAdminLevyPercent: z.number().min(0).max(100),
  defaultMaxPositions: z.number().int().min(1).max(50),
  defaultStopLossPercent: z.number().min(0).max(100),
  defaultTakeProfitPercent: z.number().min(0).max(100),
  defaultMaxPositionSizePercent: z.number().min(1).max(100),
});

// GET: return current trading config (or defaults)
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json(DEFAULTS);
    }

    const config = await getSystemConfig<typeof DEFAULTS>('trading');
    if (!config) {
      return NextResponse.json(DEFAULTS);
    }

    return NextResponse.json({
      defaultAdminLevyPercent: config.defaultAdminLevyPercent ?? DEFAULTS.defaultAdminLevyPercent,
      defaultMaxPositions: config.defaultMaxPositions ?? DEFAULTS.defaultMaxPositions,
      defaultStopLossPercent: config.defaultStopLossPercent ?? DEFAULTS.defaultStopLossPercent,
      defaultTakeProfitPercent: config.defaultTakeProfitPercent ?? DEFAULTS.defaultTakeProfitPercent,
      defaultMaxPositionSizePercent: config.defaultMaxPositionSizePercent ?? DEFAULTS.defaultMaxPositionSizePercent,
    });
  } catch {
    return NextResponse.json(DEFAULTS);
  }
}

// POST: save trading config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = tradingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    await saveSystemConfig('trading', parsed.data);

    return NextResponse.json({ success: true, message: 'Trading config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save trading config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}
