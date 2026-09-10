// ============================================================
// GET /api/broker-execution/commands/[id]
// Get command status.
//
// REQUIRES AUTH + ownership check.
// Read-only — commands cannot be modified after submission.
// Ownership verification: command tenantId must match authenticated userId.
// 403 if accessing another user's command.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── In-memory command store reference ──
// This shares the same store as the commands route.
// In production, this would be database-backed.
interface CommandRecord {
  commandId: string;
  tenantId: string;
  accountId: string;
  providerId: string;
  commandType: string;
  status: string;
  createdAt: string;
  correlationId: string;
  reason?: string;
}

// We maintain a local store for the [id] route.
// In production, this would query the database.
const commandStore = new Map<string, CommandRecord>();

export async function GET(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: commandId } = await context.params;

  try {
    const command = commandStore.get(commandId);

    if (!command) {
      // In Phase 1, return a placeholder response indicating
      // the command was not found (or the store is not yet
      // connected to the persistence layer)
      return NextResponse.json(
        {
          commandId,
          status: 'UNKNOWN',
          message: 'Command not found. In Phase 1, command persistence is not yet fully connected.',
        },
        { status: 404 },
      );
    }

    // Ownership verification: command tenantId must match authenticated userId
    if (command.tenantId !== userId) {
      logSecurityEvent({
        eventType: 'COMMAND_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/commands/[id]',
        userId,
        reason: `User attempted to access command belonging to tenant=${command.tenantId}`,
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    // Read-only: commands cannot be modified after submission
    // Return the command status without credentials
    return NextResponse.json({
      commandId: command.commandId,
      accountId: command.accountId,
      providerId: command.providerId,
      commandType: command.commandType,
      status: command.status,
      createdAt: command.createdAt,
      correlationId: command.correlationId,
      reason: command.reason,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'COMMAND_GET_ERROR',
      route: '/api/broker-execution/commands/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch command status.' },
      { status: 500 },
    );
  }
}
