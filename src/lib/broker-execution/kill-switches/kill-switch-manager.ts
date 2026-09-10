// ============================================================
// kill-switch-manager.ts — In-memory kill switch manager
// with PostgreSQL persistence
//
// CONTAINMENT CONSTRAINT:
//   Kill switches are the highest-priority execution gate
//   (evaluated in gate 11 of policy-gate.ts). When a kill
//   switch is ACTIVE or TRIGGERED for a given scope:
//     - All execution commands in that scope are BLOCKED
//     - No BrokerAdapter execution methods are called
//     - The BLOCKED state persists until explicitly deactivated
//
//   Kill switches override all other gates:
//     - Even if enforceLiveTradingPolicy() would allow the
//       operation (demo account), an active kill switch
//       blocks it.
//     - Even if capabilities are present, an active kill
//       switch blocks execution.
//
//   SERVER-ENFORCED ONLY:
//     Kill switches are evaluated server-side. There are
//     NO client-side kill switches. Client code cannot
//     bypass, disable, or influence kill switch state.
//
//   PERSISTENCE:
//     Kill switch state is maintained in-memory for fast
//     evaluation and persisted to PostgreSQL for durability.
//     On startup, state is loaded from the database.
//     Every activation/deactivation is audited.
//
//   EMERGENCY READ-ONLY MODE:
//     When emergencyReadOnly is true on an active kill switch,
//     even read-only operations (quotes, positions, orders)
//     are blocked. This is the most aggressive containment.
// ============================================================

import { db, safeDbQuery } from '@/lib/db';
import { logSecurityEvent } from '@/lib/trading-policy';
import type {
  ExecutionCommand,
} from '@/lib/broker-execution/types';
import type {
  KillSwitch,
  KillSwitchScope,
  KillSwitchState,
} from '@/lib/broker-execution/types/kill-switches';
import {
  KillSwitchScope as KillSwitchScopeEnum,
  KillSwitchState as KillSwitchStateEnum,
} from '@/lib/broker-execution/types/kill-switches';
import { v4 as uuidv4 } from 'uuid';

// ── In-memory store ──

/**
 * In-memory kill switch store keyed by id.
 * Populated from PostgreSQL on first access and kept
 * in sync on every activate/deactivate.
 */
const killSwitchStore = new Map<string, KillSwitch>();

/** Whether the store has been hydrated from the database */
let storeHydrated = false;

// ── Scope precedence ──

/**
 * Evaluation order for kill switch scopes.
 * Broader scopes are checked first. If both GLOBAL and
 * TENANT switches are active, GLOBAL is reported.
 */
const SCOPE_PRECEDENCE: readonly KillSwitchScope[] = [
  KillSwitchScopeEnum.GLOBAL,
  KillSwitchScopeEnum.TENANT,
  KillSwitchScopeEnum.ACCOUNT,
  KillSwitchScopeEnum.PROVIDER,
] as const;

// ── Admin user check ──

/**
 * Check if a user ID represents an admin user.
 * In production, this would query the User/UserSettings table
 * for the admin role. For now, we use a convention-based check.
 *
 * @param userId - The user ID to check
 * @returns true if the user is an admin
 */
function isAdminUser(userId: string): boolean {
  if (!userId || userId.trim() === '') return false;
  // Convention: admin users have 'admin' in their ID or
  // are system actors. In production, query the database.
  return userId === 'system' || userId.startsWith('admin_');
}

// ── Database hydration ──

/**
 * Hydrate the in-memory kill switch store from PostgreSQL.
 * Called lazily on first evaluation to avoid startup overhead.
 *
 * Uses the SystemConfig table with key 'kill_switches' to
 * persist the serialized kill switch state as JSON.
 */
async function hydrateFromDatabase(): Promise<void> {
  if (storeHydrated) return;

  const config = await safeDbQuery(async () => {
    if (!db) return null;
    return db.systemConfig.findUnique({
      where: { key: 'kill_switches' },
    });
  });

  if (config?.config) {
    try {
      const switches = JSON.parse(config.config) as KillSwitch[];
      for (const ks of switches) {
        killSwitchStore.set(ks.id, ks);
      }
    } catch (e) {
      console.warn('[KillSwitchManager] Failed to parse persisted kill switches:', e);
    }
  }

  storeHydrated = true;
}

// ── Database persistence ──

/**
 * Persist the current in-memory kill switch state to PostgreSQL.
 * Called after every activate/deactivate operation.
 */
async function persistToDatabase(): Promise<void> {
  const switches = Array.from(killSwitchStore.values());
  const json = JSON.stringify(switches);

  await safeDbQuery(async () => {
    if (!db) return;
    await db.systemConfig.upsert({
      where: { key: 'kill_switches' },
      create: {
        key: 'kill_switches',
        config: json,
      },
      update: {
        config: json,
      },
    });
  });
}

// ── Evaluate kill switches ──

/**
 * Evaluate whether a command should be blocked by any
 * active kill switch. Checks scopes in precedence order:
 * GLOBAL → TENANT → ACCOUNT → PROVIDER.
 *
 * Returns the first active kill switch found (broadest scope
 * takes precedence), or null if no kill switch is active
 * for any scope relevant to the command.
 *
 * @param command - The execution command to evaluate
 * @returns The blocking KillSwitch if any, or null if not blocked
 */
export async function evaluateKillSwitches(
  command: ExecutionCommand,
): Promise<KillSwitch | null> {
  await hydrateFromDatabase();

  // Build the scope IDs to check for this command
  const scopeChecks: Array<{ scope: KillSwitchScope; scopeId: string }> = [
    { scope: KillSwitchScopeEnum.GLOBAL, scopeId: 'global' },
    { scope: KillSwitchScopeEnum.TENANT, scopeId: command.tenantId },
    { scope: KillSwitchScopeEnum.ACCOUNT, scopeId: command.accountId },
    { scope: KillSwitchScopeEnum.PROVIDER, scopeId: command.providerId },
  ];

  // Check in precedence order (GLOBAL first)
  for (const { scope, scopeId } of scopeChecks) {
    for (const ks of killSwitchStore.values()) {
      if (
        ks.scope === scope &&
        ks.scopeId === scopeId &&
        (ks.state === KillSwitchStateEnum.ACTIVE || ks.state === KillSwitchStateEnum.TRIGGERED)
      ) {
        logSecurityEvent({
          eventType: 'KILL_SWITCH_EVAL_BLOCK',
          commandId: command.commandId,
          killSwitchId: ks.id,
          scope: ks.scope,
          scopeId: ks.scopeId,
          state: ks.state,
          reason: `Kill switch ${ks.id} is ${ks.state} for ${scope}:${scopeId}`,
        });
        return ks;
      }
    }
  }

  return null;
}

/**
 * Evaluate kill switches for a given scope and scope ID.
 * Returns the combined result: if any ACTIVE or TRIGGERED
 * kill switch is found, it blocks everything.
 *
 * @param scope - The scope to evaluate
 * @param scopeId - The scope identifier
 * @returns The blocking KillSwitch if any, or null
 */
export async function evaluateKillSwitchesByScope(
  scope: KillSwitchScope,
  scopeId: string,
): Promise<KillSwitch | null> {
  await hydrateFromDatabase();

  for (const ks of killSwitchStore.values()) {
    if (
      ks.scope === scope &&
      ks.scopeId === scopeId &&
      (ks.state === KillSwitchStateEnum.ACTIVE || ks.state === KillSwitchStateEnum.TRIGGERED)
    ) {
      return ks;
    }
  }

  return null;
}

// ── Activate kill switch ──

/**
 * Activate a kill switch for the given scope.
 *
 * ONLY admin users can activate kill switches.
 * If a kill switch already exists for the same scope+scopeId,
 * it is re-activated (updated with new reason and activatedBy).
 * If not, a new kill switch is created.
 *
 * Activation is audited to the security event log and
 * persisted to PostgreSQL.
 *
 * @param scope - The kill switch scope (GLOBAL, TENANT, ACCOUNT, PROVIDER)
 * @param scopeId - The identifier within the scope
 * @param activatedBy - The user ID activating the kill switch (must be admin)
 * @param reason - Human-readable reason for activation
 * @param emergencyReadOnly - Whether to block even read-only operations
 * @returns The activated KillSwitch
 * @throws Error if the caller is not an admin user
 */
export async function activateKillSwitch(params: {
  scope: KillSwitchScope;
  scopeId: string;
  activatedBy: string;
  reason: string;
  emergencyReadOnly?: boolean;
}): Promise<KillSwitch> {
  if (!isAdminUser(params.activatedBy)) {
    throw new Error(
      `Kill switch activation denied: user '${params.activatedBy}' is not an admin. ` +
      `Only admin users can activate kill switches.`,
    );
  }

  await hydrateFromDatabase();

  // Check for existing kill switch with same scope+scopeId
  let existingKs: KillSwitch | null = null;
  for (const ks of killSwitchStore.values()) {
    if (ks.scope === params.scope && ks.scopeId === params.scopeId) {
      existingKs = ks;
      break;
    }
  }

  const now = new Date().toISOString();

  if (existingKs) {
    // Re-activate existing kill switch
    const updated: KillSwitch = {
      ...existingKs,
      state: KillSwitchStateEnum.ACTIVE,
      activatedAt: now,
      deactivatedAt: null,
      activatedBy: params.activatedBy,
      reason: params.reason,
      emergencyReadOnly: params.emergencyReadOnly ?? existingKs.emergencyReadOnly,
    };
    killSwitchStore.set(updated.id, updated);

    logSecurityEvent({
      eventType: 'KILL_SWITCH_ACTIVATE',
      killSwitchId: updated.id,
      scope: updated.scope,
      scopeId: updated.scopeId,
      activatedBy: params.activatedBy,
      reason: params.reason,
    });

    await persistToDatabase();
    return updated;
  }

  // Create new kill switch
  const newKs: KillSwitch = {
    id: uuidv4(),
    scope: params.scope,
    scopeId: params.scopeId,
    state: KillSwitchStateEnum.ACTIVE,
    activatedAt: now,
    deactivatedAt: null,
    activatedBy: params.activatedBy,
    reason: params.reason,
    emergencyReadOnly: params.emergencyReadOnly ?? false,
  };
  killSwitchStore.set(newKs.id, newKs);

  logSecurityEvent({
    eventType: 'KILL_SWITCH_ACTIVATE',
    killSwitchId: newKs.id,
    scope: newKs.scope,
    scopeId: newKs.scopeId,
    activatedBy: params.activatedBy,
    reason: params.reason,
  });

  await persistToDatabase();
  return newKs;
}

// ── Deactivate kill switch ──

/**
 * Deactivate a kill switch.
 *
 * ONLY admin users can deactivate kill switches.
 * If the kill switch is already inactive, this is a no-op.
 * Deactivation is audited and persisted.
 *
 * @param id - The kill switch ID to deactivate
 * @param deactivatedBy - The user ID deactivating the kill switch (must be admin)
 * @returns The deactivated KillSwitch
 * @throws Error if the caller is not an admin user
 * @throws Error if the kill switch ID is not found
 */
export async function deactivateKillSwitch(params: {
  killSwitchId: string;
  deactivatedBy: string;
}): Promise<KillSwitch> {
  if (!isAdminUser(params.deactivatedBy)) {
    throw new Error(
      `Kill switch deactivation denied: user '${params.deactivatedBy}' is not an admin. ` +
      `Only admin users can deactivate kill switches.`,
    );
  }

  await hydrateFromDatabase();

  const ks = killSwitchStore.get(params.killSwitchId);
  if (!ks) {
    throw new Error(`Kill switch '${params.killSwitchId}' not found.`);
  }

  if (ks.state === KillSwitchStateEnum.INACTIVE) {
    // Already inactive, no-op
    return ks;
  }

  const now = new Date().toISOString();
  const updated: KillSwitch = {
    ...ks,
    state: KillSwitchStateEnum.INACTIVE,
    deactivatedAt: now,
    emergencyReadOnly: false,
  };
  killSwitchStore.set(updated.id, updated);

  logSecurityEvent({
    eventType: 'KILL_SWITCH_DEACTIVATE',
    killSwitchId: updated.id,
    scope: updated.scope,
    scopeId: updated.scopeId,
    deactivatedBy: params.deactivatedBy,
    reason: `Kill switch deactivated by ${params.deactivatedBy}`,
  });

  await persistToDatabase();
  return updated;
}

// ── Emergency read-only mode ──

/**
 * Check if emergency read-only mode is active for a given scope.
 * When active, all mutations are blocked — only reads are allowed.
 *
 * This checks ALL kill switches that apply to the given scope
 * (including broader scopes) and returns true if ANY of them
 * has emergencyReadOnly=true and is in ACTIVE or TRIGGERED state.
 *
 * @param tenantId - The tenant ID to check
 * @param accountId - The account ID to check
 * @param providerId - The provider ID to check
 * @returns true if emergency read-only mode is active
 */
export async function emergencyReadOnlyMode(
  tenantId: string,
  accountId: string,
  providerId: string,
): Promise<boolean> {
  await hydrateFromDatabase();

  const scopeChecks: Array<{ scope: KillSwitchScope; scopeId: string }> = [
    { scope: KillSwitchScopeEnum.GLOBAL, scopeId: 'global' },
    { scope: KillSwitchScopeEnum.TENANT, scopeId: tenantId },
    { scope: KillSwitchScopeEnum.ACCOUNT, scopeId: accountId },
    { scope: KillSwitchScopeEnum.PROVIDER, scopeId: providerId },
  ];

  for (const { scope, scopeId } of scopeChecks) {
    for (const ks of killSwitchStore.values()) {
      if (
        ks.scope === scope &&
        ks.scopeId === scopeId &&
        (ks.state === KillSwitchStateEnum.ACTIVE || ks.state === KillSwitchStateEnum.TRIGGERED) &&
        ks.emergencyReadOnly
      ) {
        return true;
      }
    }
  }

  return false;
}

// ── Status query ──

/**
 * Get the current status of a specific kill switch.
 *
 * @param killSwitchId - The kill switch ID
 * @returns The KillSwitch if found, or null
 */
export async function getKillSwitchStatus(
  killSwitchId: string,
): Promise<KillSwitch | null> {
  await hydrateFromDatabase();
  return killSwitchStore.get(killSwitchId) ?? null;
}

/**
 * List all kill switches, optionally filtered by scope.
 *
 * @param filter - Optional filter by scope and/or scopeId
 * @returns Array of matching KillSwitch instances
 */
export async function getAllKillSwitches(filter?: {
  scope?: KillSwitchScope;
  scopeId?: string;
}): Promise<KillSwitch[]> {
  await hydrateFromDatabase();

  const all = Array.from(killSwitchStore.values());

  if (!filter) return all;

  return all.filter((ks) => {
    if (filter.scope && ks.scope !== filter.scope) return false;
    if (filter.scopeId && ks.scopeId !== filter.scopeId) return false;
    return true;
  });
}
