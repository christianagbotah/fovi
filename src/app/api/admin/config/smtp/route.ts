import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { invalidateSmtpCache } from '@/lib/email';
import {
  isSealedSmtpPassword,
  isUnknownEncryptedSmtpPassword,
  openSmtpPassword,
  sealSmtpPassword,
  SMTP_PASSWORD_REDACTION,
} from '@/lib/smtp-secret';

const saveSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1),
  password: z.string().min(1),
  from: z.string().min(1),
});

type StoredSmtpConfig = {
  host?: unknown;
  port?: unknown;
  user?: unknown;
  password?: unknown;
  from?: unknown;
};

function publicSmtpConfig(config: StoredSmtpConfig) {
  const storedPassword = typeof config.password === 'string' ? config.password : '';
  return {
    host: typeof config.host === 'string' ? config.host : '',
    port: String(config.port || 587),
    user: typeof config.user === 'string' ? config.user : '',
    password: storedPassword ? SMTP_PASSWORD_REDACTION : '',
    from: typeof config.from === 'string' ? config.from : '',
  };
}

// GET: return current SMTP config without exposing any password material.
export async function GET() {
  try {
    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ configured: false });
    }

    const row = await safeDbQuery(() =>
      db!.systemConfig.findUnique({ where: { key: 'smtp' } })
    );

    if (!row) {
      return NextResponse.json({ configured: false });
    }

    const stored = JSON.parse(row.config) as StoredSmtpConfig;
    const config = publicSmtpConfig(stored);

    // `config` is the shape consumed by the current admin UI. Keep the
    // existing top-level non-secret fields for compatibility with older
    // clients while replacing the old partial-password mask with a fixed
    // non-secret sentinel.
    return NextResponse.json({
      configured: true,
      config,
      host: config.host,
      port: Number(config.port),
      user: config.user,
      password: config.password,
      from: config.from,
    });
  } catch {
    return NextResponse.json({ configured: false });
  }
}

// POST: save SMTP config with the password protected at rest.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    let storedPassword: string | null = null;

    if (parsed.data.password === SMTP_PASSWORD_REDACTION) {
      const existingRow = await safeDbQuery(() =>
        db!.systemConfig.findUnique({ where: { key: 'smtp' } })
      );

      if (!existingRow) {
        return NextResponse.json({ error: 'SMTP password is required.' }, { status: 400 });
      }

      const existingConfig = JSON.parse(existingRow.config) as StoredSmtpConfig;
      const existingPassword = typeof existingConfig.password === 'string'
        ? existingConfig.password
        : '';

      if (!existingPassword) {
        return NextResponse.json({ error: 'SMTP password is required.' }, { status: 400 });
      }

      if (isUnknownEncryptedSmtpPassword(existingPassword)) {
        return NextResponse.json({ error: 'Stored SMTP credential cannot be opened.' }, { status: 503 });
      }

      if (isSealedSmtpPassword(existingPassword)) {
        // Confirm the retained ciphertext is still decryptable with the active
        // key before preserving it. A key mismatch therefore fails closed.
        const openedPassword = await openSmtpPassword(existingPassword);
        if (!openedPassword) {
          return NextResponse.json({ error: 'SMTP credential protection is unavailable.' }, { status: 503 });
        }
        storedPassword = existingPassword;
      } else {
        // Legacy plaintext is accepted for compatibility but migrated to
        // protected storage on the next admin save.
        storedPassword = await sealSmtpPassword(existingPassword);
      }
    } else {
      storedPassword = await sealSmtpPassword(parsed.data.password);
    }

    if (!storedPassword) {
      return NextResponse.json({ error: 'SMTP credential protection is unavailable.' }, { status: 503 });
    }

    const storedConfig = {
      ...parsed.data,
      password: storedPassword,
    };

    await db.systemConfig.upsert({
      where: { key: 'smtp' },
      create: { key: 'smtp', config: JSON.stringify(storedConfig) },
      update: { config: JSON.stringify(storedConfig) },
    });

    invalidateSmtpCache();

    return NextResponse.json({ success: true, message: 'SMTP config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save SMTP config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}
