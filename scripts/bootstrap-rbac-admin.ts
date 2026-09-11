import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminRole = await prisma.role.findUnique({
    where: { code: 'system_admin' },
    select: {
      id: true,
      assignments: {
        select: { userId: true },
        take: 1,
      },
    },
  });

  if (!adminRole) {
    throw new Error(
      'RBAC bootstrap refused: system_admin role is missing. Apply the RBAC migration first.',
    );
  }

  // Idempotent after the first successful migration. Once an explicit admin
  // assignment exists, legacy email configuration is no longer needed here.
  if (adminRole.assignments.length > 0) {
    console.log('[RBAC Bootstrap] Existing system_admin assignment found; no action required.');
    return;
  }

  const bootstrapEmail = (
    process.env.RBAC_BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || ''
  ).trim().toLowerCase();

  if (!bootstrapEmail) {
    throw new Error(
      'RBAC bootstrap refused: no existing admin assignment and no RBAC_BOOTSTRAP_ADMIN_EMAIL was provided.',
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

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: adminRole.id,
      assignedByUserId: null,
    },
  });

  console.log('[RBAC Bootstrap] system_admin assignment created successfully.');
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