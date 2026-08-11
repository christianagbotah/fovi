import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { createPaymentInvoice } from '@/lib/hubtel';
import { randomUUID } from 'crypto';

const subscribeSchema = z.object({
  planId: z.string().min(1),
  phoneNumber: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
});

// POST: create subscription and payment invoice
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan') || !hasModel('subscription')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const { planId, phoneNumber, email } = parsed.data;

    // Fetch the plan
    const plan = await safeDbQuery(() =>
      db!.subscriptionPlan.findUnique({ where: { id: planId } })
    );

    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'Plan not found or inactive.' }, { status: 404 });
    }

    // Fetch the user
    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id: userId } })
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const clientReference = `fovi-sub-${userId}-${planId}-${Date.now()}`;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || '';

    // Calculate subscription period (1 month from now)
    const startsAt = new Date();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    // Create a pending subscription in the DB
    const subscription = await db.subscription.create({
      data: {
        userId,
        plan: plan.name,
        status: 'past_due', // Will be set to 'active' on successful payment
        amount: plan.price,
        currency: plan.currency,
        startedAt: startsAt,
        expiresAt,
      },
    });

    // Create Hubtel payment invoice
    const invoiceResult = await createPaymentInvoice({
      totalAmount: plan.price,
      description: `Fovi AI ${plan.displayName} Plan — Monthly Subscription`,
      clientReference,
      customer: {
        email: email || user.email,
        phoneNumber: phoneNumber || undefined,
        name: user.name || undefined,
      },
      callbackUrl: `${baseUrl}/api/payments/hubtel/callback`,
      cancelUrl: `${baseUrl}/settings`,
      returnUrl: `${baseUrl}/settings`,
    });

    if (!invoiceResult.success) {
      // Update subscription status to cancelled
      await safeDbQuery(() =>
        db!.subscription.update({
          where: { id: subscription.id },
          data: { status: 'cancelled' },
        })
      );

      return NextResponse.json(
        { error: invoiceResult.error || 'Failed to create payment invoice.' },
        { status: 500 }
      );
    }

    // Update subscription with invoice details
    await safeDbQuery(() =>
      db!.subscription.update({
        where: { id: subscription.id },
        data: {
          hubtelInvoiceId: invoiceResult.invoiceId || null,
          hubtelResponse: JSON.stringify(invoiceResult.response),
        },
      })
    );

    return NextResponse.json({
      success: true,
      invoiceUrl: invoiceResult.invoiceUrl,
      subscriptionId: subscription.id,
      clientReference,
    });
  } catch (err) {
    console.error('[Subscribe] Failed:', err);
    return NextResponse.json({ error: 'Failed to create subscription.' }, { status: 500 });
  }
}
