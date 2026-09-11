import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { createPaymentInvoice } from '@/lib/hubtel';

// GET: list all subscriptions with user info (admin only)
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('subscription') || !hasModel('user')) {
      return NextResponse.json(
        { error: 'Subscription storage is unavailable.' },
        { status: 503 },
      );
    }

    const subscriptions = await db.subscription.findMany({
      include: {
        user: {
          select: { id: true, email: true, name: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({ subscriptions });
  } catch (err) {
    console.error('[Admin Subscriptions] Failed to list:', err);
    return NextResponse.json({ error: 'Failed to fetch subscriptions.' }, { status: 503 });
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
      return NextResponse.json({ error: 'Subscription storage is unavailable.' }, { status: 503 });
    }

    const { userId, planId, phoneNumber } = parsed.data;

    // A query exception is not equivalent to a missing plan. Let storage
    // failures reach the catch block instead of being collapsed to undefined.
    const plan = await db.subscriptionPlan.findUnique({ where: { id: planId } });

    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'Plan not found or inactive.' }, { status: 404 });
    }

    // Likewise, distinguish a real 404 from inability to query user storage.
    const user = await db.user.findUnique({ where: { id: userId } });

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
      // Persist the cancellation deterministically. Do not hide a failed
      // compensation write behind safeDbQuery and then report clean failure.
      await db.subscription.update({
        where: { id: subscription.id },
        data: { status: 'cancelled' },
      });

      return NextResponse.json(
        { error: invoiceResult.error || 'Failed to create payment invoice.' },
        { status: 500 }
      );
    }

    // Invoice metadata is part of the durable admin operation. If this write
    // fails, return failure rather than a success response with incomplete state.
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        hubtelInvoiceId: invoiceResult.invoiceId || null,
        hubtelResponse: JSON.stringify(invoiceResult.response),
      },
    });

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
    return NextResponse.json(
      { error: 'Admin subscription operation could not be completed.' },
      { status: 503 },
    );
  }
}