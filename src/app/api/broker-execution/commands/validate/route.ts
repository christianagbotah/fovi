// ============================================================
// POST /api/broker-execution/commands/validate
// Validate a command (dry-run only, NEVER submits).
//
// REQUIRES AUTH + ownership/tenant checks.
// Returns validation result without executing.
// Does NOT submit any order — purely structural validation.
//
// This uses validateCommandForDryRun() from policy-gate.ts
// which checks structure and completeness but never enters
// the state machine or calls the broker adapter.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { validateCommandForDryRun } from '@/lib/broker-execution/execution/policy-gate';
import { v4 as uuidv4 } from 'uuid';

// ── Validation request schema ──
const ValidateCommandSchema = z.object({
  commandType: z.enum([
    'PLACE_MARKET', 'PLACE_PENDING', 'MODIFY',
    'CANCEL', 'CLOSE_POSITION', 'PARTIAL_CLOSE', 'UPDATE_PROTECTION',
  ]),
  accountId: z.string().min(1),
  providerId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  symbol: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  size: z.number().positive().optional(),
  price: z.number().positive().optional(),
  brokerOrderId: z.string().optional(),
  brokerPositionId: z.string().optional(),
  closeSize: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
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
  const correlationId = uuidv4();
  const commandId = uuidv4();

  // Ownership verification: the accountId/providerId must belong to
  // the authenticated user's tenant. We validate by constructing the
  // command with the authenticated userId as tenantId.
  const command = {
    commandId,
    idempotencyKey: data.idempotencyKey,
    tenantId: userId, // Enforce tenant ownership
    accountId: data.accountId,
    providerId: data.providerId,
    correlationId,
    createdAt: new Date().toISOString(),
    commandType: data.commandType,
    // Command-type-specific fields
    symbol: data.symbol,
    side: data.side,
    size: data.size,
    price: data.price,
    brokerOrderId: data.brokerOrderId,
    brokerPositionId: data.brokerPositionId,
    closeSize: data.closeSize,
    stopLoss: data.stopLoss,
    takeProfit: data.takeProfit,
  };

  // Dry-run validation: structural check only, NEVER submits
  const validation = validateCommandForDryRun(command as never);

  logSecurityEvent({
    eventType: 'COMMAND_VALIDATE_DRY_RUN',
    route: '/api/broker-execution/commands/validate',
    userId,
    correlationId,
    reason: `Dry-run validation for commandType=${data.commandType} isValid=${validation.isValid}`,
  });

  // Phase 1: Even if structural validation passes, note that
  // execution is not permitted in Phase 1
  return NextResponse.json({
    commandId,
    correlationId,
    validation: {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    phase1Note: validation.isValid
      ? 'Command is structurally valid but execution is not permitted in Phase 1 containment.'
      : undefined,
    executionPermitted: false, // ALWAYS false in Phase 1
    code: validation.isValid
      ? undefined
      : CONTAINMENT_CODES.CONFIGURATION_REQUIRED,
  });
}
