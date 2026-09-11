// ============================================================
// GET /api/broker-execution/commands/[id]
// Get command status.
//
// CORRECTION ROUND (defect 3): this route now queries the SAME
// authoritative PostgreSQL store (ExecutionCommandRecord) that
// POST /commands writes — the previous split module-local Maps
// are REMOVED. A command created by POST is always retrievable
// here, across processes and restarts.
//
// REQUIRES AUTH + ownership check (tenant-scoped query).
// Read-only — commands cannot be modified after submission.
// Returns 404 when the command does not exist OR belongs to
// another tenant (no cross-tenant information disclosure).
// Returns 503 (fail-closed) when the authoritative store is
// unavailable.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import {
  CommandRepository,
  toCommandDTO,
} from '@/lib/broker-execution/persistence/command-repository';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: commandId } = await context.params;

  try {
    // Tenant-scoped authoritative query: returns null when the
    // command does not exist OR belongs to another tenant.
    const row = await CommandRepository.findByCommandIdAndTenant(commandId, userId);

    if (!row) {
      return NextResponse.json(
        {
          commandId,
          status: 'UNKNOWN',
          error: 'Command not found.',
          remediationPhase: 'containment',
        },
        { status: 404 },
      );
    }

    // Read-only: commands cannot be modified after submission.
    // The DTO contains no credentials (commands never carry them).
    return NextResponse.json(toCommandDTO(row));
  } catch (error) {
    logSecurityEvent({
      eventType: 'COMMAND_GET_ERROR',
      route: '/api/broker-execution/commands/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch command status.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}
