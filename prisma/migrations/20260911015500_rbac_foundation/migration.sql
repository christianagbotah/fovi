-- Phase 3BA: explicit RBAC foundation.
-- Runtime authorization cutover is intentionally a later dependent slice.

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId")
);

CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);

CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

ALTER TABLE "UserRole"
ADD CONSTRAINT "UserRole_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePermission"
ADD CONSTRAINT "RolePermission_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePermission"
ADD CONSTRAINT "RolePermission_permissionId_fkey"
FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed immutable system role and permission catalog. User assignment is done
-- separately by the one-time bootstrap script so no email address is embedded
-- in schema history.
INSERT INTO "Role" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES (
  'role_system_admin',
  'system_admin',
  'System Administrator',
  'Full administrative control-plane access.',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Permission" ("id", "code", "description", "createdAt", "updatedAt") VALUES
  ('perm_admin_access', 'admin.access', 'Enter the administrative control plane.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_users_read', 'admin.users.read', 'Read administrative user records.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_users_write', 'admin.users.write', 'Modify administrative user state.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_finance_read', 'admin.finance.read', 'Read administrative financial dashboards.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_subscriptions_read', 'admin.subscriptions.read', 'Read administrative subscription records.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_subscriptions_write', 'admin.subscriptions.write', 'Modify administrative subscriptions.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_config_read', 'admin.config.read', 'Read administrative platform configuration.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_config_write', 'admin.config.write', 'Modify administrative platform configuration.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_brokers_read', 'admin.brokers.read', 'Read broker-provider configuration.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_admin_brokers_write', 'admin.brokers.write', 'Modify broker-provider configuration.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."code" = 'system_admin'
  AND p."code" LIKE 'admin.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;