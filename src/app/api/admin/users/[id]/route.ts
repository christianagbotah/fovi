import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import { revokeOutstandingTwoFactorChallenges } from '@/lib/two-factor-challenges';

// ============================================================
// Zod schemas
// ============================================================

const toggleActiveSchema = z.object({
  action: z.literal('toggle_active'),
});

const resetPasswordSchema = z.object({
  action: z.literal('reset_password'),
  newPassword: z.string().min(8).max(128),
});

const deleteSchema = z.object({
  hardDelete: z.boolean().optional(),
});

// PATCH: toggle active status or reset password
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id } })
    );
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const body = await request.json();

    const toggleParsed = toggleActiveSchema.safeParse(body);
    if (toggleParsed.success) {
      const nextActive = !(user.isActive ?? true);
      const updated = await db.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id },
          data: { isActive: nextActive },
        });
        if (!nextActive) {
          await revokeAllAuthSessionsForUser(tx, id, 'ACCOUNT_INACTIVE');
          await revokeOutstandingTwoFactorChallenges(tx, id);
        }
        return result;
      });
      return NextResponse.json({
        success: true,
        message: `User is now ${updated.isActive ? 'active' : 'inactive'}.`,
        isActive: updated.isActive,
      });
    }

    const resetParsed = resetPasswordSchema.safeParse(body);
    if (resetParsed.success) {
      const passwordHash = hashPassword(resetParsed.data.newPassword);
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { passwordHash },
        });
        await revokeAllAuthSessionsForUser(tx, id, 'ADMIN_PASSWORD_RESET');
        await revokeOutstandingTwoFactorChallenges(tx, id);
      });
      return NextResponse.json({
        success: true,
        message: 'Password reset successfully. Existing sessions were revoked.',
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use {action: "toggle_active"} or {action: "reset_password", newPassword: "..."}' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[Admin] Failed to update user:', err);
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 });
  }
}

// DELETE: soft-delete (isActive=false) or hard delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id } })
    );
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    let hardDelete = false;
    try {
      const body = await request.json();
      const parsed = deleteSchema.safeParse(body);
      if (parsed.success) {
        hardDelete = parsed.data.hardDelete ?? false;
      }
    } catch {
      // No body — default to soft delete
    }

    if (hardDelete) {
      // AuthSession and TwoFactorChallenge both cascade from User, so deleting
      // the user removes all remaining session and challenge rows.
      await db.user.delete({ where: { id } });
      return NextResponse.json({ success: true, message: 'User permanently deleted.' });
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { isActive: false },
      });
      await revokeAllAuthSessionsForUser(tx, id, 'ACCOUNT_INACTIVE');
      await revokeOutstandingTwoFactorChallenges(tx, id);
    });
    return NextResponse.json({ success: true, message: 'User deactivated (soft delete).' });
  } catch (err) {
    console.error('[Admin] Failed to delete user:', err);
    return NextResponse.json({ error: 'Failed to delete user.' }, { status: 500 });
  }
}
