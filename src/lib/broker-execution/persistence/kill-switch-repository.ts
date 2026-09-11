// ============================================================
// kill-switch-repository.ts — PostgreSQL-backed kill-switch
// persistence (CORRECTION ROUND, defect 6).
//
// SECURITY CONTRACT:
//   - KillSwitchRecord is the AUTHORITATIVE kill-switch store.
//     The old SystemConfig JSON blob store is REMOVED. Kill-switch
//     state is durable and visible to all concurrent instances.
//   - GLOBAL scope uses the canonical non-null scopeId 'global';
//     @@unique([scope, scopeId]) genuinely enforces singleton
//     GLOBAL semantics (PostgreSQL composite unique indexes permit
//     multiple NULLs — nullable scopeId would not).
//   - Every evaluation queries PostgreSQL directly. There is NO
//     hydrated cache: on DB read failure the evaluation throws
//     KillSwitchEvaluationUnavailableError so execution-relevant
//     callers fail CLOSED — the store NEVER assumes "no kill
//     switches exist" when the database cannot be reached.
//   - Activation/deactivation write the audit entry in the SAME
//     transaction. If persistence fails, NO success is returned —
//     in-memory state is never allowed to claim durability that
//     PostgreSQL does not have.
//   - Authorization is NOT handled here. Admin permission is
//     decided by the API boundary from the verified JWT role
//     (proxy-injected X-User-Role). There is NO user-ID prefix
//     convention ('admin_' / 'system') anywhere in this module.
// ============================================================

import { logSecurityEvent } from '@/lib/trading-policy';
import { requireDb, ServiceUnavailableError, isDbUnavailableError } from './db-access';
import { sanitizeBrokerAuditInput } from '../observability/redaction';
import type { KillSwitch, KillSwitchScope, KillSwitchState } from '@/lib/broker-execution/types/kill-switches';
import {
  KillSwitchScope as KillSwitchScopeEnum,
  KillSwitchState as KillSwitchStateEnum,
} from '@/lib/broker-execution/types/kill-switches';

// ── Row shape ──

export interface KillSwitchRecordRow {
  id: string;
  scope: string;
  scopeId: string;
  state: string;
  emergencyReadOnly: boolean;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  activatedBy: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Fail-closed evaluation error ──

/**
 * Thrown when kill-switch state cannot be authoritatively
 * evaluated (DB unavailable). Execution-relevant callers MUST
 * fail closed on this error — never assume no switches exist.
 */
export class KillSwitchEvaluationUnavailableError extends Error {
  readonly code = 'KILL_SWITCH_UNAVAILABLE';

  constructor(detail?: string) {
    super(
      `Fail-closed: kill-switch state cannot be authoritatively evaluated.` +
        (detail ? ` (${detail})` : ''),
    );
    this.name = 'KillSwitchEvaluationUnavailableError';
  }
}

// ── Canonical scope handling ──

/** The canonical scopeId for the GLOBAL scope (never NULL). */
export const GLOBAL_SCOPE_ID = 'global';

/**
 * Canonicalize a (scope, scopeId) pair:
 *   - GLOBAL → scopeId is FORCED to the canonical 'global'
 *     (caller-supplied values for GLOBAL are ignored/rejected)
 *   - TENANT/ACCOUNT/PROVIDER → a concrete non-empty scopeId is required
 */
export function canonicalScopeId(
  scope: KillSwitchScope | string,
  scopeId: string | undefined | null,
): { ok: true; scopeId: string } | { ok: false; reason: string } {
  const normalizedScope = String(scope).toUpperCase();
  if (normalizedScope === KillSwitchScopeEnum.GLOBAL) {
    // GLOBAL is a singleton identified by the canonical scopeId.
    return { ok: true, scopeId: GLOBAL_SCOPE_ID };
  }
  if (
    normalizedScope === KillSwitchScopeEnum.TENANT ||
    normalizedScope === KillSwitchScopeEnum.ACCOUNT ||
    normalizedScope === KillSwitchScopeEnum.PROVIDER
  ) {
    if (!scopeId || scopeId.trim() === '') {
      return { ok: false, reason: `Scope ${normalizedScope} requires a concrete scopeId.` };
    }
    return { ok: true, scopeId: scopeId.trim() };
  }
  return { ok: false, reason: `Unknown kill-switch scope '${scope}'.` };
}

// ── Row mapping ──

function rowToKillSwitch(row: KillSwitchRecordRow): KillSwitch {
  return {
    id: row.id,
    scope: row.scope as KillSwitchScope,
    scopeId: row.scopeId,
    state: row.state as KillSwitchState,
    emergencyReadOnly: row.emergencyReadOnly,
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
    activatedBy: row.activatedBy,
    reason: row.reason,
  };
}

// ── Repository ──

export const KillSwitchRepository = {
  /**
   * List kill switches (optionally filtered by scope/scopeId).
   * Authoritative: queries PostgreSQL on every call. Throws
   * KillSwitchEvaluationUnavailableError when the DB cannot be
   * reached (fail-closed — never "assume none exist").
   */
  async listKillSwitches(filter?: {
    scope?: KillSwitchScope;
    scopeId?: string;
  }): Promise<KillSwitch[]> {
    try {
      const db = requireDb('kill-switch repository list');
      const rows = await db.killSwitchRecord.findMany({
        where: {
          ...(filter?.scope ? { scope: filter.scope } : {}),
          ...(filter?.scopeId ? { scopeId: filter.scopeId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      return (rows as unknown as KillSwitchRecordRow[]).map(rowToKillSwitch);
    } catch (error) {
      throw toEvaluationUnavailable(error);
    }
  },

  /**
   * Evaluate the blocking kill switch for a command's scope set
   * (GLOBAL, TENANT, ACCOUNT, PROVIDER) in precedence order.
   *
   * Authoritative PostgreSQL query on EVERY evaluation — concurrent
   * instances always see the same state. Throws
   * KillSwitchEvaluationUnavailableError on DB failure so callers
   * fail CLOSED (execution is blocked when the store cannot be
   * proven switch-free).
   */
  async evaluateForCommand(command: {
    tenantId: string;
    accountId: string;
    providerId: string;
  }): Promise<KillSwitch | null> {
    let rows: KillSwitchRecordRow[];
    try {
      const db = requireDb('kill-switch repository evaluate');
      rows = (await db.killSwitchRecord.findMany({
        where: {
          state: { in: [KillSwitchStateEnum.ACTIVE, KillSwitchStateEnum.TRIGGERED] },
          OR: [
            { scope: KillSwitchScopeEnum.GLOBAL, scopeId: GLOBAL_SCOPE_ID },
            { scope: KillSwitchScopeEnum.TENANT, scopeId: command.tenantId },
            { scope: KillSwitchScopeEnum.ACCOUNT, scopeId: command.accountId },
            { scope: KillSwitchScopeEnum.PROVIDER, scopeId: command.providerId },
          ],
        },
      })) as unknown as KillSwitchRecordRow[];
    } catch (error) {
      throw toEvaluationUnavailable(error);
    }

    // Precedence: GLOBAL > TENANT > ACCOUNT > PROVIDER
    const precedence: string[] = [
      KillSwitchScopeEnum.GLOBAL,
      KillSwitchScopeEnum.TENANT,
      KillSwitchScopeEnum.ACCOUNT,
      KillSwitchScopeEnum.PROVIDER,
    ];
    for (const scope of precedence) {
      const match = rows.find((row) => row.scope === scope);
      if (match) {
        return rowToKillSwitch(match);
      }
    }
    return null;
  },

  /**
   * Activate (or re-activate) a kill switch for a scope.
   *
   * The activation and its audit entry are written in ONE
   * PostgreSQL transaction. If persistence fails, an error is
   * thrown — NO success is returned and no memory state can
   * claim durability the database does not have.
   *
   * Authorization is the API boundary's responsibility (verified
   * admin role). This method performs no user-ID-based checks.
   */
  async activateKillSwitch(params: {
    scope: KillSwitchScope | string;
    scopeId?: string | null;
    activatedBy: string;
    reason: string;
    emergencyReadOnly?: boolean;
  }): Promise<KillSwitch> {
    const canonical = canonicalScopeId(params.scope, params.scopeId);
    if (!canonical.ok) {
      throw new Error(canonical.reason);
    }

    const db = requireDb('kill-switch repository activate');

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.killSwitchRecord.upsert({
        where: {
          scope_scopeId: { scope: String(params.scope).toUpperCase(), scopeId: canonical.scopeId },
        },
        create: {
          scope: String(params.scope).toUpperCase(),
          scopeId: canonical.scopeId,
          state: KillSwitchStateEnum.ACTIVE,
          emergencyReadOnly: params.emergencyReadOnly ?? false,
          activatedAt: new Date(),
          deactivatedAt: null,
          activatedBy: params.activatedBy,
          reason: params.reason,
        },
        update: {
          state: KillSwitchStateEnum.ACTIVE,
          emergencyReadOnly: params.emergencyReadOnly ?? false,
          activatedAt: new Date(),
          deactivatedAt: null,
          activatedBy: params.activatedBy,
          reason: params.reason,
        },
      });

      await tx.brokerExecutionAudit.create({
        data: sanitizeBrokerAuditInput({
          actorId: params.activatedBy,
          tenantId: 'system',
          action: 'KILL_SWITCH_ACTIVATE',
          previousState: 'KILL_SWITCH_INACTIVE',
          resultingState: `KILL_SWITCH_ACTIVE:${String(params.scope).toUpperCase()}:${canonical.scopeId}`,
          reason: params.reason,
          commandId: null,
        }) as never,
      });

      return row;
    });

    logSecurityEvent({
      eventType: 'KILL_SWITCH_ACTIVATE',
      killSwitchId: updated.id,
      scope: String(params.scope).toUpperCase(),
      scopeId: canonical.scopeId,
      activatedBy: params.activatedBy,
      reason: params.reason,
    });

    return rowToKillSwitch(updated as unknown as KillSwitchRecordRow);
  },

  /**
   * Deactivate a kill switch by its record id (or scope+scopeId).
   * Same fail-closed transactional contract as activation.
   */
  async deactivateKillSwitch(params: {
    killSwitchId?: string;
    scope?: KillSwitchScope | string;
    scopeId?: string | null;
    deactivatedBy: string;
  }): Promise<KillSwitch> {
    const db = requireDb('kill-switch repository deactivate');

    const updated = await db.$transaction(async (tx) => {
      let row: KillSwitchRecordRow | null = null;

      if (params.killSwitchId) {
        row = (await tx.killSwitchRecord.findUnique({
          where: { id: params.killSwitchId },
        })) as unknown as KillSwitchRecordRow | null;
        if (!row) {
          throw new Error(`Kill switch '${params.killSwitchId}' not found.`);
        }
      } else if (params.scope) {
        const canonical = canonicalScopeId(params.scope, params.scopeId);
        if (!canonical.ok) throw new Error(canonical.reason);
        row = (await tx.killSwitchRecord.findUnique({
          where: {
            scope_scopeId: {
              scope: String(params.scope).toUpperCase(),
              scopeId: canonical.scopeId,
            },
          },
        })) as unknown as KillSwitchRecordRow | null;
        if (!row) {
          throw new Error(`Kill switch for scope '${params.scope}:${canonical.scopeId}' not found.`);
        }
      } else {
        throw new Error('Either killSwitchId or scope+scopeId is required.');
      }

      const result = await tx.killSwitchRecord.update({
        where: { id: row.id },
        data: {
          state: KillSwitchStateEnum.INACTIVE,
          deactivatedAt: new Date(),
          emergencyReadOnly: false,
        },
      });

      await tx.brokerExecutionAudit.create({
        data: sanitizeBrokerAuditInput({
          actorId: params.deactivatedBy,
          tenantId: 'system',
          action: 'KILL_SWITCH_DEACTIVATE',
          previousState: `KILL_SWITCH_ACTIVE:${row.scope}:${row.scopeId}`,
          resultingState: 'KILL_SWITCH_INACTIVE',
          reason: `Kill switch deactivated by ${params.deactivatedBy}`,
          commandId: null,
        }) as never,
      });

      return result;
    });

    logSecurityEvent({
      eventType: 'KILL_SWITCH_DEACTIVATE',
      killSwitchId: updated.id,
      scope: updated.scope,
      scopeId: updated.scopeId,
      deactivatedBy: params.deactivatedBy,
      reason: `Kill switch deactivated by ${params.deactivatedBy}`,
    });

    return rowToKillSwitch(updated as unknown as KillSwitchRecordRow);
  },

  /** Get a single kill switch by record id. Fail-closed on DB errors. */
  async getKillSwitch(killSwitchId: string): Promise<KillSwitch | null> {
    try {
      const db = requireDb('kill-switch repository get');
      const row = await db.killSwitchRecord.findUnique({
        where: { id: killSwitchId },
      });
      return row ? rowToKillSwitch(row as unknown as KillSwitchRecordRow) : null;
    } catch (error) {
      throw toEvaluationUnavailable(error);
    }
  },
};

// ── Helpers ──

function toEvaluationUnavailable(error: unknown): KillSwitchEvaluationUnavailableError {
  if (error instanceof ServiceUnavailableError) {
    return new KillSwitchEvaluationUnavailableError(error.message);
  }
  if (isDbUnavailableError(error)) {
    return new KillSwitchEvaluationUnavailableError('database unreachable');
  }
  return new KillSwitchEvaluationUnavailableError(
    error instanceof Error ? error.message : 'unknown evaluation failure',
  );
}
