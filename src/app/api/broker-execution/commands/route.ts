// ============================================================
// POST/GET /api/broker-execution/commands
// Execution command submission and history.
//
// POST: Submit execution command (REQUIRES AUTH + ownership/tenant)
//       ALL commands go through the execution policy gate →
//       WILL BE BLOCKED in Phase 1.
//       enforceLiveTradingPolicy() called as first check.
//       Ownership verification: command tenantId must match authenticated userId.
//       Returns 401 if not authenticated.
//       Returns 403 if command blocked by policy (always in Phase 1).
//
// GET:  List command history (REQUIRES AUTH + tenant scope)
//       Only returns commands belonging to the authenticated user.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import {
  enforceLiveTradingPolicy,
  CONTAINMENT_CODES,
  logSecurityEvent,
  safeAccountDTO,
} from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

// ── In-memory command store (Phase 1 placeholder) ──
// Commands are stored in-memory for Phase 1.
// Production would use database persistence.
interface CommandRecord {
  commandId: string;
  tenantId: string;
  accountId: string;
  providerId: string;
  commandType: string;
  status: 'SUBMITTED' | 'BLOCKED' | 'VALIDATING' | 'APPROVED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  correlationId: string;
  reason?: string;
}

const commandStore = new Map<string, CommandRecord>();

// ── Command submission schema ──
const CommandSchema = z.object({
  commandType: z.enum([
    'PLACE_MARKET', 'PLACE_PENDING', 'MODIFY',
    'CANCEL', 'CLOSE_POSITION', 'PARTIAL_CLOSE', 'UPDATE_PROTECTION',
  ]),
  accountId: z.string().min(1),
  providerId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  // Command-type-specific payload
  symbol: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  size: z.number().positive().optional(),
  price: z.number().positive().optional(),
  brokerOrderId: z.string().optional(),
  brokerPositionId: z.string().optional(),
});

// ============================================================
// POST — Submit execution command
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

  const commandId = uuidv4();
  const correlationId = uuidv4();
  const createdAt = new Date().toISOString();

  // ── Phase 1 CONTAINMENT: ALL commands go through the execution policy gate ──
  // enforceLiveTradingPolicy() is the FIRST check.
  // In Phase 1, ALL non-demo commands are unconditionally blocked.
  // We construct a synthetic account to check against.
  const account = {
    broker: parsed.data.providerId === 'demo' ? 'demo' : 'live',
    accountType: parsed.data.providerId === 'demo' ? 'demo' : 'live',
    isDemo: parsed.data.providerId === 'demo',
  };

  const policy = enforceLiveTradingPolicy(
    account,
    `command submission (${parsed.data.commandType})`,
  );
  if (policy.blocked) {
    // Record the blocked command
    const blockedRecord: CommandRecord = {
      commandId,
      tenantId: userId,
      accountId: parsed.data.accountId,
      providerId: parsed.data.providerId,
      commandType: parsed.data.commandType,
      status: 'BLOCKED',
      createdAt,
      correlationId,
      reason: 'Phase 1 containment: command blocked by execution policy gate',
    };
    commandStore.set(commandId, blockedRecord);

    logSecurityEvent({
      eventType: 'COMMAND_BLOCKED_BY_POLICY',
      route: '/api/broker-execution/commands',
      userId,
      correlationId,
      reason: `Command ${parsed.data.commandType} blocked by enforceLiveTradingPolicy`,
    });

    // Return the policy's blocked response (which includes containment code)
    // but add our correlation context
    return NextResponse.json(
      {
        error: 'Phase 1 containment: command execution is not permitted.',
        code: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
        commandId,
        correlationId,
        remediationPhase: 'containment',
      },
      { status: 403 },
    );
  }

  // If somehow policy allowed (demo account), record as submitted
  // (In Phase 1, this path only executes for demo accounts)
  const record: CommandRecord = {
    commandId,
    tenantId: userId,
    accountId: parsed.data.accountId,
    providerId: parsed.data.providerId,
    commandType: parsed.data.commandType,
    status: 'SUBMITTED',
    createdAt,
    correlationId,
  };
  commandStore.set(commandId, record);

  return NextResponse.json(
    safeAccountDTO(record as unknown as Record<string, unknown>),
    { status: 201 },
  );
}

// ============================================================
// GET — List command history (tenant-scoped)
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
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Tenant isolation: only return commands belonging to the authenticated user
    const userCommands = Array.from(commandStore.values())
      .filter((cmd) => cmd.tenantId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);

    return NextResponse.json({
      commands: userCommands,
      count: userCommands.length,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'COMMANDS_GET_ERROR',
      route: '/api/broker-execution/commands',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch command history.' },
      { status: 500 },
    );
  }
}
