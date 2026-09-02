import { db, hasModel, isDbAvailable } from '@/lib/db';

const OTP_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Best-effort bounded cleanup. Authentication success never depends on cleanup. */
export async function cleanupOtpRetention(): Promise<void> {
  if (!isDbAvailable() || !db) return;

  const cutoff = new Date(Date.now() - OTP_RETENTION_MS);
  const now = new Date();
  const jobs: Promise<unknown>[] = [];

  if (hasModel('smsOtp')) {
    jobs.push(db.smsOtp.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ verified: true }, { expiresAt: { lt: now } }],
      },
    }));
  }

  if (hasModel('emailOtp')) {
    jobs.push(db.emailOtp.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ verified: true }, { expiresAt: { lt: now } }],
      },
    }));
  }

  await Promise.allSettled(jobs);
}
