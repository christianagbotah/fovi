// ============================================================
// POST /api/broker-execution/commands/validate
// Validate a command (dry-run only, NEVER submits).
//
// CORRECTION ROUND (defect 2): ownership is now proven from
// server-side PostgreSQL records — `tenantId = userId` alone is
// NOT accepted as proof that the accountId belongs to the user.
// The route resolves the supplied connection from PostgreSQL and
// requires ownership; if DB availability cannot be proven it
// returns 503 and fails closed.
//
// Dry-run validation remains NON-EXECUTING and NON-PERSISTING:
//   - no state transition is recorded
//   - no command record is created
//   - no idempotency key is claimed
//   - no broker adapter method is called
// It purely checks structure against the server-side command
// built from trusted records.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { resolveOwnedConnection } from '@/lib/broker-execution/security/ownership';
import { validateCommandForDryRun } from '@/lib/broker-execution/execution/policy-gate';
import type { ExecutionCommand, CommandType } from '@/lib/broker-execution/types';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';
import { v4 as uuidv4 } from 'uuid';

// ── Validation request schema ──
const ValidateCommandSchema = z.object({
  commandType: z.enum([
    'PLACE_MARKET', 'PLACE_PENDING', 'MODIFY',
    'CANCEL', 'CLOSE_POSITION', 'PARTIAL_CLOSE', 'UPDATE_PROTECTION',
  ]),
  /** The BrokerConnection this command targets (ownership proven server-side). */
  connectionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
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

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const raw = await req.json().catch(() => null);
  const parsed = ValidateCommandSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid input: ${first?.path.join('.') || 'field'} — ${first?.message}` },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // ── Ownership: resolve the connection from PostgreSQL (fail-closed) ──
  const resolution = await resolveOwnedConnection(data.connectionId, userId);
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.message, code: resolution.code, remediationPhase: 'containment' },
      { status: resolution.status },
    );
  }
  const connection = resolution.connection;

  // ── Build the command server-side from trusted DB records ──
  const command: ExecutionCommand = {
    commandId: uuidv4(),
    idempotencyKey: data.idempotencyKey,
    tenantId: connection.tenantId, // from DB — ownership proven server-side
    accountId: connection.accountId ?? connection.id, // from DB
    providerId: connection.providerId, // from DB
    correlationId: uuidv4(),
    createdAt: new Date().toISOString(),
    commandType: data.commandType as CommandType,
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

  // Dry-run validation: structural check only, NEVER submits and
  // NEVER persists (no command record, no transition, no audit).
  const validation = validateCommandForDryRun(command);

  logSecurityEvent({
    eventType: 'COMMAND_VALIDATE_DRY_RUN',
    route: '/api/broker-execution/commands/validate',
    userId,
    correlationId: command.correlationId,
    reason: `Dry-run validation for commandType=${data.commandType} isValid=${validation.isValid}`,
  });

  return NextResponse.json({
    commandId: command.commandId,
    correlationId: command.correlationId,
    validation: {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    executionPermitted: false, // ALWAYS false in Phase 1
    phase1Note: validation.isValid
      ? 'Command is structurally valid but execution is not permitted in Phase 1 containment.'
      : undefined,
    remediationPhase: 'containment',
  });
}
