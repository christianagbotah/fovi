import { db, hasModel, isDbAvailable } from '@/lib/db';

export const AUTHZ_PERMISSIONS = {
  ADMIN_ACCESS: 'admin.access',
  ADMIN_USERS_READ: 'admin.users.read',
  ADMIN_USERS_WRITE: 'admin.users.write',
  ADMIN_FINANCE_READ: 'admin.finance.read',
  ADMIN_SUBSCRIPTIONS_READ: 'admin.subscriptions.read',
  ADMIN_SUBSCRIPTIONS_WRITE: 'admin.subscriptions.write',
  ADMIN_CONFIG_READ: 'admin.config.read',
  ADMIN_CONFIG_WRITE: 'admin.config.write',
  ADMIN_BROKERS_READ: 'admin.brokers.read',
  ADMIN_BROKERS_WRITE: 'admin.brokers.write',
} as const;

export type PermissionCode =
  (typeof AUTHZ_PERMISSIONS)[keyof typeof AUTHZ_PERMISSIONS];

export interface AuthorizationSnapshot {
  userId: string;
  roles: string[];
  permissions: string[];
}

const RBAC_MODELS = [
  'user',
  'role',
  'permission',
  'userRole',
  'rolePermission',
] as const;

/**
 * Resolve current authorization state from durable records.
 *
 * This helper is deliberately fail-closed:
 * - an unavailable database/model returns null;
 * - a missing or inactive user returns null;
 * - a query failure returns null;
 * - UserRole is never honored without revalidating the User record first.
 *
 * Runtime authorization cutover is a separate dependent slice. Keeping this
 * helper side-effect free makes that cutover reviewable and reversible.
 */
export async function getAuthorizationSnapshot(
  userId: string,
): Promise<AuthorizationSnapshot | null> {
  if (!userId || !isDbAvailable() || !db) return null;
  if (RBAC_MODELS.some((model) => !hasModel(model))) return null;

  const database = db;

  try {
    const user = await database.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });

    if (!user?.isActive) return null;

    const assignments = await database.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            code: true,
            permissions: {
              select: {
                permission: {
                  select: { code: true },
                },
              },
            },
          },
        },
      },
    });

    const roles = [...new Set(assignments.map((assignment) => assignment.role.code))].sort();
    const permissions = [
      ...new Set(
        assignments.flatMap((assignment) =>
          assignment.role.permissions.map((grant) => grant.permission.code),
        ),
      ),
    ].sort();

    return {
      userId: user.id,
      roles,
      permissions,
    };
  } catch (error) {
    console.error(
      '[RBAC] Authorization lookup failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return null;
  }
}

export async function hasPermission(
  userId: string,
  permission: PermissionCode,
): Promise<boolean> {
  const authorization = await getAuthorizationSnapshot(userId);
  return authorization?.permissions.includes(permission) ?? false;
}

export async function hasEveryPermission(
  userId: string,
  permissions: readonly PermissionCode[],
): Promise<boolean> {
  const authorization = await getAuthorizationSnapshot(userId);
  if (!authorization) return false;

  const granted = new Set(authorization.permissions);
  return permissions.every((permission) => granted.has(permission));
}