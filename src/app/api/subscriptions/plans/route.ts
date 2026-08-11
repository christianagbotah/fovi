import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

const createSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  price: z.number().min(0),
  currency: z.string().optional().default('GHS'),
  features: z.array(z.string()).optional().default([]),
  maxBots: z.number().int().min(0).optional().default(1),
  maxAccounts: z.number().int().min(0).optional().default(1),
  sortOrder: z.number().int().optional().default(0),
});

// GET: return all active plans ordered by sortOrder
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan')) {
      return NextResponse.json([]);
    }

    const plans = await safeDbQuery(() =>
      db!.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
    );

    const enriched = (plans || []).map((p) => ({
      ...p,
      features: JSON.parse(p.features),
    }));

    return NextResponse.json(enriched);
  } catch {
    return NextResponse.json([]);
  }
}

// POST: create a new plan (admin only)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const plan = await db.subscriptionPlan.create({
      data: {
        name: parsed.data.name,
        displayName: parsed.data.displayName,
        price: parsed.data.price,
        currency: parsed.data.currency,
        features: JSON.stringify(parsed.data.features),
        maxBots: parsed.data.maxBots,
        maxAccounts: parsed.data.maxAccounts,
        sortOrder: parsed.data.sortOrder,
      },
    });

    return NextResponse.json({
      ...plan,
      features: JSON.parse(plan.features),
    }, { status: 201 });
  } catch (err) {
    console.error('[Plans] Failed to create plan:', err);
    return NextResponse.json({ error: 'Failed to create plan.' }, { status: 500 });
  }
}
