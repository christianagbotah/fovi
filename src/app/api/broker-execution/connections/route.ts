// ============================================================
// GET/POST /api/broker-execution/connections
// Broker connection management.
//
// CORRECTION ROUND (defects 4, 8):
//   - Connections are persisted to PostgreSQL (BrokerConnection) —
//     the list comes from the authoritative store, not a Map.
//   - POST resolves the provider from the canonical registry
//     server-side: the caller may ONLY choose a providerId.
//     Provider type, demo classification, availability and auth
//     mechanism are NEVER taken from the request. Contradictory or
//     unknown values are rejected. REST_WS does NOT imply demo.
//   - Credentials (demo-only in Phase 1) are encrypted fail-closed
//     and stored in the encrypted columns. NEVER plaintext, never
//     in API responses.
//   - GET returns only the authenticated tenant's connections.
//   - Fail-closed: 503 when the authoritative store is unavailable.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { getConnectionManager, TenantIsolationError } from '@/lib/broker-execution/connection/connection-manager';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';
import { CREDENTIAL_FIELDS, type BrokerCredentials } from '@/lib/broker-execution/connection/credential-vault';

// ── Connection creation schema ──
// providerId is the ONLY caller-chosen provider input.
// Caller-supplied isDemo/providerType/accountType are accepted ONLY
// for contradiction detection — they are never trusted.
const CreateConnectionSchema = z.object({
  providerId: z.string().min(1),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  credentials: z
    .object({
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
      passphrase: z.string().optional(),
      token: z.string().optional(),
      refreshToken: z.string().optional(),
    })
    .optional(),
  // Contradiction-detection fields (never trusted for classification)
  isDemo: z.boolean().optional(),
  providerType: z.string().optional(),
  accountType: z.string().optional(),
});

/** Extract sanitized network metadata for audit (no credentials). */
function extractIpMetadata(req: NextRequest): Record<string, unknown> {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  };
}

// ============================================================
// GET — List connections (authoritative PostgreSQL, tenant-scoped)
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  try {
    const manager = getConnectionManager();
    const connections = await manager.listConnections(userId);

    return NextResponse.json({
      connections,
      count: connections.length,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'CONNECTIONS_GET_ERROR',
      route: '/api/broker-execution/connections',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch connections.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}

// ============================================================
// POST — Create connection (canonical provider resolution)
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const raw = await req.json().catch(() => null);
  const parsed = CreateConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid input: ${first?.path.join('.') || 'field'} — ${first?.message}` },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Only non-empty credential fields are forwarded (Phase 1 blocks
  // non-demo intake at the persistence boundary, fail-closed).
  const credentials: BrokerCredentials | undefined = data.credentials
    ? Object.fromEntries(
        Object.entries(data.credentials).filter(([, v]) => typeof v === 'string' && v.length > 0),
      )
    : undefined;
  const hasCredentials =
    !!credentials && CREDENTIAL_FIELDS.some((f) => (credentials as Record<string, string | undefined>)[f]);

  try {
    const manager = getConnectionManager();
    const connection = await manager.createConnection(
      {
        tenantId: userId,
        providerId: data.providerId,
        accountId: data.accountId ?? null,
        accountName: data.accountName ?? null,
        credentials: hasCredentials ? credentials : undefined,
        // Caller classification claims — NEVER trusted; passed only
        // so the canonical resolver can detect and reject contradictions.
        callerClaims: {
          isDemo: data.isDemo,
          providerType: data.providerType,
          accountType: data.accountType,
        },
      },
      { actorId: userId, ipMetadata: extractIpMetadata(req) },
    );

    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? persistenceErrorStatus(error);
    const code = (error as { code?: string }).code ?? 'CONNECTION_CREATE_FAILED';
    logSecurityEvent({
      eventType: 'CONNECTION_CREATE_ERROR',
      route: '/api/broker-execution/connections',
      userId,
      reason: error instanceof TenantIsolationError
        ? 'Tenant isolation violation'
        : error instanceof Error
          ? error.message
          : 'Unknown error',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create connection.', code, remediationPhase: 'containment' },
      { status },
    );
  }
}
