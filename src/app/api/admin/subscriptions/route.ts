import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { createPaymentInvoice } from '@/lib/hubtel';

// GET: list all subscriptions with user info (admin only)
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('subscription') || !hasModel('user')) {
      return NextResponse.json({ subscriptions: [] });
    }

    const subscriptions = await safeDbQuery(() =>
      db!.subscription.findMany({
        include: {
          user: {
            select: { id: true, email: true, name: true, isActive: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    );

    return NextResponse.json({ subscriptions: subscriptions || [] });
  } catch (err) {
    console.error('[Admin Subscriptions] Failed to list:', err);
    return NextResponse.json({ error: 'Failed to fetch subscriptions.' }, { status: 500 });
  }
}

const sendLinkSchema = z.object({
  userId: z.string().min(1),
  planId: z.string().min(1),
  phoneNumber: z.string().optional(),
});

// POST: admin sends a subscription payment link to a user via Hubtel
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = sendLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscriptionPlan') || !hasModel('subscription') || !hasModel('user')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const { userId, planId, phoneNumber } = parsed.data;

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

    const clientReference = `fovi-admin-${userId}-${planId}-${Date.now()}`;
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
        status: 'past_due',
        amount: plan.price,
        currency: plan.currency,
        startedAt: startsAt,
        expiresAt,
      },
    });

    // Create Hubtel payment invoice
    const invoiceResult = await createPaymentInvoice({
      totalAmount: plan.price,
      description: `Fovi AI ${plan.displayName} Plan — Monthly Subscription (Admin Sent)`,
      clientReference,
      customer: {
        email: user.email,
        phoneNumber: phoneNumber || undefined,
        name: user.name || undefined,
      },
      callbackUrl: `${baseUrl}/api/payments/hubtel/callback`,
      cancelUrl: `${baseUrl}/`,
      returnUrl: `${baseUrl}/`,
    });

    if (!invoiceResult.success) {
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
      user: { email: user.email, name: user.name },
      plan: plan.displayName,
      clientReference,
    });
  } catch (err) {
    console.error('[Admin Subscriptions] Failed to send link:', err);
    return NextResponse.json({ error: 'Failed to send subscription link.' }, { status: 500 });
  }
}
