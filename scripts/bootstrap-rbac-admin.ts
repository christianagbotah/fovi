import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminRole = await prisma.role.findUnique({
    where: { code: 'system_admin' },
    select: { id: true },
  });

  if (!adminRole) {
    throw new Error(
      'RBAC bootstrap refused: system_admin role is missing. Apply the RBAC migration first.',
    );
  }

  // Do not treat an arbitrary assignment row as proof that administration is
  // usable. UserRole intentionally has no FK to the legacy User model, so an
  // orphaned/inactive/unverified assignment must not suppress bootstrap.
  const existingAssignments = await prisma.userRole.findMany({
    where: { roleId: adminRole.id },
    select: { userId: true },
  });

  if (existingAssignments.length > 0) {
    const existingAdmin = await prisma.user.findFirst({
      where: {
        id: { in: existingAssignments.map((assignment) => assignment.userId) },
        isActive: true,
        emailVerified: true,
      },
      select: { id: true },
    });

    if (existingAdmin) {
      console.log('[RBAC Bootstrap] Active verified system_admin assignment found; no action required.');
      return;
    }

    console.warn(
      '[RBAC Bootstrap] Existing system_admin assignment(s) are not backed by an active verified user; attempting safe bootstrap.',
    );
  }

  // A brand-new database legitimately has no user to assign yet. This is not
  // an administrator lockout because no prior administrator exists. Allow the
  // first deployment to complete; after the intended user has signed up and
  // verified their email, rerun `bun run auth:bootstrap-admin`.
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.warn(
      '[RBAC Bootstrap] No users exist yet; initial administrator assignment is deferred. ' +
        'After the intended administrator signs up and verifies email, run `bun run auth:bootstrap-admin`.',
    );
    return;
  }

  const bootstrapEmail = (
    process.env.RBAC_BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || ''
  ).trim().toLowerCase();

  if (!bootstrapEmail) {
    throw new Error(
      'RBAC bootstrap refused: users exist, no active verified system_admin assignment exists, and no RBAC_BOOTSTRAP_ADMIN_EMAIL was provided.',
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: bootstrapEmail },
    select: {
      id: true,
      isActive: true,
      emailVerified: true,
    },
  });

  if (!user) {
    throw new Error('RBAC bootstrap refused: bootstrap user does not exist.');
  }
  if (!user.isActive) {
    throw new Error('RBAC bootstrap refused: bootstrap user is inactive.');
  }
  if (!user.emailVerified) {
    throw new Error('RBAC bootstrap refused: bootstrap user email is not verified.');
  }

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: adminRole.id,
      assignedByUserId: null,
    },
  });

  console.log('[RBAC Bootstrap] Active verified system_admin assignment is ready.');
}

main()
  .catch((error) => {
    console.error(
      '[RBAC Bootstrap] Failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });