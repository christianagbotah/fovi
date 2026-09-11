// ============================================================
// kill-switch-manager.ts — Kill-switch domain layer
// (CORRECTION ROUND, defect 6)
//
// This module is now a thin domain layer over
// kill-switch-repository.ts. KillSwitchRecord (PostgreSQL) is the
// AUTHORITATIVE store. The previous implementation's defects are
// removed:
//
//   REMOVED: SystemConfig JSON as the authoritative store
//   REMOVED: in-memory Map + "hydrated" flag (hydration failure
//            used to silently look like "no switches exist")
//   REMOVED: 'admin_' / 'system' user-ID-prefix authorization
//            convention — authorization is decided at the API
//            boundary from the VERIFIED JWT role (proxy-injected
//            X-User-Role), never from a user ID
//
// FAIL-CLOSED CONTRACT:
//   - evaluateKillSwitches() throws
//     KillSwitchEvaluationUnavailableError when the authoritative
//     store cannot be read. Execution-relevant callers must treat
//     this as "blocked/unavailable" — NEVER as "no kill switch".
//   - activate/deactivate throw on persistence failure — the API
//     returns 503, never false success.
//   - Every evaluation queries PostgreSQL directly, so concurrent
//     instances always see authoritative state.
//
// SERVER-ENFORCED ONLY:
//   Kill switches are evaluated server-side. There are NO
//   client-side kill switches. Client code cannot bypass,
//   disable, or influence kill switch state.
// ============================================================

import type { ExecutionCommand } from '@/lib/broker-execution/types';
import type { KillSwitch, KillSwitchScope, KillSwitchState } from '@/lib/broker-execution/types/kill-switches';
import {
  KillSwitchRepository,
  KillSwitchEvaluationUnavailableError,
  GLOBAL_SCOPE_ID,
} from '../persistence/kill-switch-repository';

export { KillSwitchEvaluationUnavailableError, GLOBAL_SCOPE_ID };

// ── Evaluate kill switches ──

/**
 * Evaluate whether a command should be blocked by any active kill
 * switch. Checks scopes in precedence order: GLOBAL → TENANT →
 * ACCOUNT → PROVIDER.
 *
 * Returns the first active kill switch found (broadest scope takes
 * precedence), or null if no kill switch is active for any scope
 * relevant to the command.
 *
 * FAIL-CLOSED: throws KillSwitchEvaluationUnavailableError when the
 * authoritative PostgreSQL store cannot be read. Callers MUST fail
 * closed on this error — never treat it as "no kill switch".
 *
 * @param command - The execution command to evaluate
 * @returns The blocking KillSwitch if any, or null if not blocked
 */
export async function evaluateKillSwitches(
  command: Pick<ExecutionCommand, 'tenantId' | 'accountId' | 'providerId'>,
): Promise<KillSwitch | null> {
  return KillSwitchRepository.evaluateForCommand({
    tenantId: command.tenantId,
    accountId: command.accountId,
    providerId: command.providerId,
  });
}

/**
 * Evaluate kill switches for a given scope and scopeId.
 * Same fail-closed contract as evaluateKillSwitches().
 */
export async function evaluateKillSwitchesByScope(
  scope: KillSwitchScope,
  scopeId: string,
): Promise<KillSwitch | null> {
  const switches = await KillSwitchRepository.listKillSwitches({ scope, scopeId });
  const blocking = switches.find(
    (ks) => ks.state === 'ACTIVE' || ks.state === 'TRIGGERED',
  );
  return blocking ?? null;
}

// ── Activate kill switch ──

/**
 * Activate a kill switch for the given scope.
 *
 * Authorization is NOT checked here — the API boundary must verify
 * the caller's admin role from the verified JWT security context
 * BEFORE calling this function. There is no user-ID-based check
 * and no 'admin_'/'system' convention.
 *
 * The activation and its audit entry are persisted in ONE
 * PostgreSQL transaction. On persistence failure this throws —
 * the API must return 503, never false success.
 */
export async function activateKillSwitch(params: {
  scope: KillSwitchScope | string;
  scopeId?: string | null;
  activatedBy: string;
  reason: string;
  emergencyReadOnly?: boolean;
}): Promise<KillSwitch> {
  return KillSwitchRepository.activateKillSwitch(params);
}

// ── Deactivate kill switch ──

/**
 * Deactivate a kill switch by record id or scope.
 * Authorization (verified admin role) is the API boundary's
 * responsibility. Throws on persistence failure (no false success).
 */
export async function deactivateKillSwitch(params: {
  killSwitchId?: string;
  scope?: KillSwitchScope | string;
  scopeId?: string | null;
  deactivatedBy: string;
}): Promise<KillSwitch> {
  return KillSwitchRepository.deactivateKillSwitch(params);
}

// ── Emergency read-only mode ──

/**
 * Check if emergency read-only mode is active for a given scope
 * set. When active, all mutations are blocked — only reads are
 * allowed. Fail-closed: throws when the store is unreachable.
 */
export async function emergencyReadOnlyMode(
  tenantId: string,
  accountId: string,
  providerId: string,
): Promise<boolean> {
  const blocking = await KillSwitchRepository.evaluateForCommand({
    tenantId,
    accountId,
    providerId,
  });
  return !!blocking && blocking.emergencyReadOnly;
}

// ── Status queries ──

/** Get the current status of a specific kill switch. Fail-closed. */
export async function getKillSwitchStatus(
  killSwitchId: string,
): Promise<KillSwitch | null> {
  return KillSwitchRepository.getKillSwitch(killSwitchId);
}

/**
 * List all kill switches, optionally filtered by scope.
 * Authoritative PostgreSQL query — throws on DB failure.
 */
export async function getAllKillSwitches(filter?: {
  scope?: KillSwitchScope;
  scopeId?: string;
}): Promise<KillSwitch[]> {
  return KillSwitchRepository.listKillSwitches(filter);
}
