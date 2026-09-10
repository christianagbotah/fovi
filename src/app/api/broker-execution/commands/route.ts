// ============================================================
// POST/GET /api/broker-execution/commands
// Execution command submission and history.
//
// CORRECTION ROUND (defects 1, 2, 3, 4, 9):
//   This route NO LONGER calls enforceLiveTradingPolicy() directly
//   and NO LONGER constructs a synthetic account from
//   caller-supplied providerId. It:
//     1. authenticates the caller;
//     2. resolves the requested connection from PostgreSQL;
//     3. proves ownership from server-side records;
//     4. derives broker/provider/demo/account context from trusted
//        DB + canonical-registry records;
//     5. constructs the policy context server-side;
//     6. enters ONE central command orchestration boundary
//        (ExecutionProvider.submitCommand), where
//        enforceLiveTradingPolicy() is the unconditional first
//        containment check;
//     7. stops before any broker adapter execution (Phase 1).
//
//   Caller-supplied tenantId/isDemo/broker/accountType values are
//   NEVER trusted.
//
// POST outcomes:
//   401 unauthenticated | 400 invalid input/contradiction
//   403 blocked by containment (persisted as BLOCKED)
//   404 connection not found | 409 idempotency conflict
//   500 internal | 503 fail-closed (DB/kill-switch store down)
//
// GET: command history — authoritative PostgreSQL records for the
// authenticated tenant only (same store POST writes).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { resolveOwnedConnection } from '@/lib/broker-execution/security/ownership';
import { getCanonicalProvider } from '@/lib/broker-execution/providers/canonical-providers';
import { executionProvider } from '@/lib/broker-execution/execution/execution-provider';
import type { PolicyEvaluationContext } from '@/lib/broker-execution/execution/policy-gate';
import type { ExecutionCommand, CommandType } from '@/lib/broker-execution/types';
import { CommandRepository, toCommandDTO } from '@/lib/broker-execution/persistence/command-repository';
import { ServiceUnavailableError, persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';
import { v4 as uuidv4 } from 'uuid';

// ── Command submission schema ──
const CommandSchema = z.object({
  commandType: z.enum([
    'PLACE_MARKET', 'PLACE_PENDING', 'MODIFY',
    'CANCEL', 'CLOSE_POSITION', 'PARTIAL_CLOSE', 'UPDATE_PROTECTION',
  ]),
  /** The BrokerConnection this command targets (ownership proven server-side). */
  connectionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  /** Optional accountId — must CORRESPOND to the connection when supplied. */
  accountId: z.string().min(1).optional(),
  // Command-type-specific payload
  symbol: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  size: z.number().positive().optional(),
  price: z.number().positive().optional(),
  orderType: z.string().optional(),
  stopPrice: z.number().positive().optional(),
  timeInForce: z.string().optional(),
  expireAt: z.string().optional(),
  brokerOrderId: z.string().optional(),
  brokerPositionId: z.string().optional(),
  closeSize: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  newPrice: z.number().positive().optional(),
  newStopLoss: z.number().positive().optional(),
  newTakeProfit: z.number().positive().optional(),
  newSize: z.number().positive().optional(),
  newStopPrice: z.number().positive().optional(),
  trailingStop: z.boolean().optional(),
  trailingStopDistance: z.number().positive().optional(),
});

/** Extract sanitized network metadata for audit (no credentials). */
function extractIpMetadata(req: NextRequest): Record<string, unknown> {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  };
}

// ============================================================
// POST — Submit execution command through the central boundary
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const raw = await req.json().catch(() => null);
  const parsed = CommandSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid input: ${first?.path.join('.') || 'field'} — ${first?.message}` },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // ── Resolve the connection from PostgreSQL and prove ownership ──
  const resolution = await resolveOwnedConnection(data.connectionId, userId);
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.message, code: resolution.code, remediationPhase: 'containment' },
      { status: resolution.status },
    );
  }
  const connection = resolution.connection;

  // ── Derive account context from TRUSTED DB records ──
  const serverAccountId = connection.accountId ?? connection.id;
  if (data.accountId && data.accountId !== serverAccountId) {
    return NextResponse.json(
      {
        error: 'accountId does not correspond to the supplied connection.',
        code: 'ACCOUNT_CONNECTION_MISMATCH',
        remediationPhase: 'containment',
      },
      { status: 400 },
    );
  }

  // ── Provider context from the canonical registry (trusted) ──
  const canonicalProvider = getCanonicalProvider(connection.providerId);

  // ── Build the command server-side (caller never sets identity) ──
  const command: ExecutionCommand = {
    commandId: uuidv4(),
    idempotencyKey: data.idempotencyKey,
    tenantId: connection.tenantId, // from DB, not from the request
    accountId: serverAccountId, // from DB, not from the request
    providerId: connection.providerId, // from DB, not from the request
    correlationId: uuidv4(),
    createdAt: new Date().toISOString(),
    commandType: data.commandType as CommandType,
    // Command-type-specific fields (validated by the boundary)
    symbol: data.symbol,
    side: data.side,
    size: data.size,
    price: data.price,
    orderType: data.orderType,
    stopPrice: data.stopPrice,
    timeInForce: data.timeInForce,
    expireAt: data.expireAt,
    brokerOrderId: data.brokerOrderId,
    brokerPositionId: data.brokerPositionId,
    closeSize: data.closeSize,
    stopLoss: data.stopLoss,
    takeProfit: data.takeProfit,
    newPrice: data.newPrice,
    newStopLoss: data.newStopLoss,
    newTakeProfit: data.newTakeProfit,
    newSize: data.newSize,
    newStopPrice: data.newStopPrice,
    trailingStop: data.trailingStop,
    trailingStopDistance: data.trailingStopDistance,
  } as ExecutionCommand;

  // ── Build the policy context server-side from trusted records ──
  // Phase 1: executionEnabled is a HARD CONSTANT (false) — it is not
  // derived from environment variables or caller input. Every
  // submission ends BLOCKED at the environment gate after passing
  // the unconditional enforceLiveTradingPolicy() first check.
  const context: PolicyEvaluationContext = {
    executionEnabled: false, // Phase 1 hard constant — never env-trust
    tenantPermissions: {
      isSuspended: false,
      canExecute: true,
      canTrade: true,
    },
    isDemo: connection.isDemo, // from DB record
    providerActive: canonicalProvider?.isConnectionAvailable ?? false, // canonical registry
    accountMode: connection.accountType, // from DB record
    connectionState: connection.connectionState as PolicyEvaluationContext['connectionState'],
    featureFlags: {}, // Phase 1: no execution feature flags enabled
    authorizationResult: {
      // Ownership was proven server-side from PostgreSQL records.
      isAuthorized: true,
      reason: 'Connection ownership proven from server-side records',
    },
    healthStatus: null, // Phase 1: no live broker connection exists
    killSwitchStatus: null, // resolved INSIDE the central boundary (fail-closed)
    account: {
      broker: connection.providerId,
      accountType: connection.accountType,
      isDemo: connection.isDemo,
    },
    actorId: userId,
    connectionId: connection.id,
    ipMetadata: extractIpMetadata(req),
  };

  // ── Enter the ONE central command orchestration boundary ──
  try {
    const result = await executionProvider.submitCommand(command, context);

    if (result.outcome === 'UNAVAILABLE') {
      return NextResponse.json(
        {
          error: result.reason,
          code: 'SERVICE_UNAVAILABLE',
          commandId: command.commandId,
          correlationId: command.correlationId,
          remediationPhase: 'containment',
        },
        { status: 503 },
      );
    }

    if (result.outcome === 'CONFLICT') {
      return NextResponse.json(
        {
          error: result.reason,
          code: 'IDEMPOTENCY_CONFLICT',
          existingCommandId: result.commandId || null,
          commandId: command.commandId,
          correlationId: command.correlationId,
          remediationPhase: 'containment',
        },
        { status: 409 },
      );
    }

    if (result.outcome === 'DUPLICATE') {
      return NextResponse.json(
        {
          commandId: result.commandId,
          status: result.state,
          outcome: 'DUPLICATE',
          reason: result.reason,
          executionPermitted: false,
          phase: '1-containment',
        },
        { status: 200 },
      );
    }

    if (result.outcome === 'BLOCKED') {
      return NextResponse.json(
        {
          error: 'Phase 1 containment: command execution is not permitted.',
          code: result.policyDecision?.containmentCode ?? 'PHASE1_LIVE_TRADING_DISABLED',
          commandId: result.commandId,
          correlationId: command.correlationId,
          status: result.state,
          remediationPhase: 'containment',
          policyDecision: {
            allowed: false,
            reason: result.policyDecision?.reason,
            containmentCode: result.policyDecision?.containmentCode,
            evaluatedGates: result.policyDecision?.evaluatedGates,
          },
        },
        { status: 403 },
      );
    }

    // APPROVED (all gates passed, execution stopped in Phase 1)
    return NextResponse.json(
      {
        commandId: result.commandId,
        status: result.state,
        outcome: result.outcome,
        reason: result.reason,
        executionPermitted: false, // ALWAYS false in Phase 1
        phase: '1-containment',
        record: result.record,
      },
      { status: 201 },
    );
  } catch (error) {
    logSecurityEvent({
      eventType: 'COMMAND_SUBMIT_ERROR',
      route: '/api/broker-execution/commands',
      userId,
      correlationId: command.correlationId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      {
        error: 'Command submission failed.',
        code: 'COMMAND_SUBMISSION_FAILED',
        remediationPhase: 'containment',
      },
      { status: persistenceErrorStatus(error) },
    );
  }
}

// ============================================================
// GET — List command history (authoritative PostgreSQL, tenant-scoped)
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const rows = await CommandRepository.listByTenant(userId, { limit, offset });

    return NextResponse.json({
      commands: rows.map(toCommandDTO),
      count: rows.length,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'COMMANDS_GET_ERROR',
      route: '/api/broker-execution/commands',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch command history.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}
