import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { getHubtelPaymentConfig } from '@/lib/hubtel';
import { createHash } from 'crypto';

/**
 * Verify that the callback actually came from Hubtel.
 * Hubtel signs callbacks with a secret that we can verify.
 */
function verifyHubtelSignature(
  body: string,
  secret: string,
  signatureHeader: string | null,
): boolean {
  // If no signature header, reject in production
  if (!signatureHeader) {
    // In dev, allow without signature for testing
    if (process.env.NODE_ENV !== 'production') return true;
    return false;
  }

  try {
    const expected = createHash('sha256').update(body + secret).digest('hex');
    // Hubtel may send the signature in different formats
    const received = signatureHeader.replace(/^sha256=/i, '');
    return expected === received;
  } catch {
    return false;
  }
}

/**
 * Hubtel payment webhook/callback.
 * Receives the Hubtel callback payload, verifies the payment,
 * and updates the subscription status accordingly.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.warn('[Hubtel Callback] Invalid JSON body');
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    console.log('[Hubtel Callback] Received:', JSON.stringify(body).slice(0, 500));

    // Verify webhook signature in production
    if (process.env.NODE_ENV === 'production') {
      const config = await getHubtelPaymentConfig();
      if (config?.clientSecret) {
        const signatureHeader = request.headers.get('x-hubtel-signature')
          || request.headers.get('hubtel-signature')
          || null;

        if (!verifyHubtelSignature(rawBody, config.clientSecret, signatureHeader)) {
          console.error('[Hubtel Callback] Invalid signature — possible tampering');
          return NextResponse.json(
            { error: 'Invalid signature' },
            { status: 401 },
          );
        }
      } else {
        console.warn('[Hubtel Callback] No Hubtel clientSecret configured — skipping signature verification');
      }
    }

    // Double-verify with Hubtel API that the payment is actually completed
    const invoiceId =
      (body?.data as Record<string, unknown>)?.invoice_id ||
      body?.invoice_id ||
      (body?.response as Record<string, unknown>)?.invoice_id ||
      body?.client_reference;

    const status =
      (body?.data as Record<string, unknown>)?.status ||
      body?.status ||
      (body?.response as Record<string, unknown>)?.status;

    if (!invoiceId) {
      console.warn('[Hubtel Callback] No invoice ID found in callback body');
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscription')) {
      console.error('[Hubtel Callback] Database not available');
      return NextResponse.json({ status: 'received' }, { status: 200 });
    }

    // Verify payment status with Hubtel API directly (defense in depth)
    const normalizedStatus = String(status || '').toLowerCase();
    let isPaid = normalizedStatus === 'completed' || normalizedStatus === 'paid' || normalizedStatus === 'success';

    if (isPaid && process.env.NODE_ENV === 'production') {
      try {
        const { checkPaymentStatus } = await import('@/lib/hubtel');
        const verifyResult = await checkPaymentStatus(String(invoiceId));
        if (verifyResult.success && verifyResult.status) {
          const verifiedStatus = String(verifyResult.status).toLowerCase();
          isPaid = verifiedStatus === 'completed' || verifiedStatus === 'paid' || verifiedStatus === 'success';
          if (!isPaid) {
            console.warn('[Hubtel Callback] Hubtel API verification shows unpaid status:', verifyResult.status);
          }
        }
      } catch (err) {
        console.error('[Hubtel Callback] Failed to verify with Hubtel API:', err);
        // If verification fails, don't activate — safer to require manual review
        isPaid = false;
      }
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

    // Map status
    let newSubscriptionStatus: string;

    if (isPaid) {
      newSubscriptionStatus = 'active';
    } else if (normalizedStatus === 'failed' || normalizedStatus === 'expired' || normalizedStatus === 'cancelled') {
      newSubscriptionStatus = 'cancelled';
    } else if (normalizedStatus === 'pending') {
      newSubscriptionStatus = 'past_due';
    } else {
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
    return NextResponse.json({ status: 'received' }, { status: 200 });
  }
}
