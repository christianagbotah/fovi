import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

// Simple HMAC-SHA1 verification using Web Crypto API
async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === signature.toLowerCase();
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // 1) Read raw body and try to parse JSON; also accept form/urlencoded
  const rawText = await req.text().catch(() => '');
  let body: Record<string, unknown> = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Try simple form parsing
    const params = new URLSearchParams(rawText);
    if (params.toString()) {
      for (const [k, v] of params.entries()) body[k] = v;
    }
  }

  // 2) Extract standard fields with multiple naming conventions
  const symbol =
    (body.symbol as string) ||
    (body.ticker as string) ||
    (body.instrument as string) ||
    'UNKNOWN';
  const side =
    (body.side as string) ||
    (body.action as string) ||
    (body.direction as string) ||
    'buy';
  const type =
    (body.type as string) ||
    (body.orderType as string) ||
    (body.signalType as string) ||
    'market';
  const qty = Number(body.qty || body.quantity || body.amount || 0);
  const price = Number(body.price || body.entryPrice || body.limitPrice || 0);

  // 3) Verify secret if provided (header or query)
  const secret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('x-signature') ||
    (body.secret as string) ||
    new URL(req.url).searchParams.get('secret');

  if (secret && rawText) {
    const sig =
      req.headers.get('x-webhook-signature') ||
      req.headers.get('x-hub-signature-256') ||
      (body.signature as string) ||
      '';
    if (sig) {
      const ok = await verifySignature(rawText, sig, secret);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
          { status: 401 },
        );
      }
    }
  }

  // 4) Always process the webhook even without db — return the parsed signal
  const signalPayload = {
    symbol,
    direction: side.toLowerCase() === 'sell' || side.toLowerCase() === 'short' ? 'bearish' : 'bullish',
    side: side.toLowerCase(),
    type,
    qty,
    price,
    confidence: Number(body.confidence ?? 0.7),
    receivedAt: new Date().toISOString(),
    raw: body,
  };

  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({
      success: true,
      processed: true,
      signal: signalPayload,
      persisted: false,
    });
  }
  try {
    // Find the default account to attach the signal to
    const userId = 'usr_demo_1';
    const account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!account) {
      // Still process — return signal even if no account
      return NextResponse.json({
        success: true,
        processed: true,
        signal: signalPayload,
        persisted: false,
      });
    }

    const created = await db.tradingSignal.create({
      data: {
        accountId: account.id,
        symbol,
        assetType: body.assetType as string | undefined ?? 'stock',
        direction: signalPayload.direction,
        confidence: signalPayload.confidence,
        signalType: type,
        timeframe: (body.timeframe as string) || '1h',
        entryPrice: price > 0 ? price : null,
        stopLoss: body.stopLoss ? Number(body.stopLoss) : null,
        takeProfit: body.takeProfit ? Number(body.takeProfit) : null,
        reasoning: `Webhook signal received. side=${side}, qty=${qty}, price=${price}`,
        status: 'active',
      },
    });

    return NextResponse.json({
      success: true,
      processed: true,
      signalId: created.id,
      signal: signalPayload,
      persisted: true,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json({
        success: true,
        processed: true,
        signal: signalPayload,
        persisted: false,
      });
    }
    const msg = error instanceof Error ? error.message : 'Failed to process webhook';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
