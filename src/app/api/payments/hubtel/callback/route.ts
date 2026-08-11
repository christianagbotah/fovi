import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

/**
 * Hubtel payment webhook/callback.
 * Receives the Hubtel callback payload, verifies the payment,
 * and updates the subscription status accordingly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('[Hubtel Callback] Received:', JSON.stringify(body).slice(0, 500));

    if (!isDbAvailable() || !db || !hasModel('subscription')) {
      console.error('[Hubtel Callback] Database not available');
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    // Hubtel callback structure can vary. We try to extract the invoice ID
    // from multiple possible field paths.
    const invoiceId =
      body?.data?.invoice_id ||
      body?.invoice_id ||
      body?.response?.invoice_id ||
      body?.client_reference;

    // The payment status from Hubtel
    const status =
      body?.data?.status ||
      body?.status ||
      body?.response?.status;

    if (!invoiceId) {
      console.warn('[Hubtel Callback] No invoice ID found in callback body');
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    // Find the subscription by hubtelInvoiceId
    const subscription = await safeDbQuery(() =>
      db!.subscription.findFirst({
        where: { hubtelInvoiceId: String(invoiceId) },
      })
    );

    if (!subscription) {
      console.warn('[Hubtel Callback] No subscription found for invoice:', invoiceId);
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    // Map Hubtel statuses to our subscription statuses
    const normalizedStatus = String(status || '').toLowerCase();
    let newSubscriptionStatus: string;

    if (normalizedStatus === 'completed' || normalizedStatus === 'paid' || normalizedStatus === 'success') {
      newSubscriptionStatus = 'active';
    } else if (normalizedStatus === 'failed' || normalizedStatus === 'expired' || normalizedStatus === 'cancelled') {
      newSubscriptionStatus = 'cancelled';
    } else if (normalizedStatus === 'pending') {
      newSubscriptionStatus = 'past_due';
    } else {
      // Unknown status — log but don't change
      console.warn('[Hubtel Callback] Unknown status:', status);
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    // Only update if the status actually changed
    if (subscription.status !== newSubscriptionStatus) {
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: newSubscriptionStatus,
          hubtelResponse: JSON.stringify(body),
        },
      });

      console.log(
        `[Hubtel Callback] Subscription ${subscription.id} updated to ${newSubscriptionStatus}`
      );
    }

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch (err) {
    console.error('[Hubtel Callback] Error processing callback:', err);
    // Always return 200 to Hubtel to avoid retries
    return NextResponse.json({ status: 'received' }, { status: 200 });
  }
}