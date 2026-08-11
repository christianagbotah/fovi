import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().optional(),
  features: z.array(z.string()).optional(),
  maxBots: z.number().int().min(0).optional(),
  maxAccounts: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH: update a plan (admin only)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const data: Record<string, unknown> = { ...parsed.data };
    // Stringify features array if present
    if (data.features) {
      data.features = JSON.stringify(data.features);
    }

    const plan = await db.subscriptionPlan.update({
      where: { id },
      data,
    });

    return NextResponse.json({
      ...plan,
      features: JSON.parse(plan.features),
    });
  } catch (err) {
    console.error('[Plans] Failed to update plan:', err);
    return NextResponse.json({ error: 'Failed to update plan.' }, { status: 500 });
  }
}

// DELETE: soft-delete a plan (set isActive=false, admin only)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const plan = await db.subscriptionPlan.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: 'Plan deactivated.' });
  } catch (err) {
    console.error('[Plans] Failed to delete plan:', err);
    return NextResponse.json({ error: 'Failed to delete plan.' }, { status: 500 });
  }
}
