import nodemailer from 'nodemailer';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

// ============================================================
// Types
// ============================================================

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

interface CachedConfig<T> {
  data: T;
  expiresAt: number;
}

// ============================================================
// In-memory config cache (5 min TTL)
// ============================================================

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const smtpCache = new Map<string, CachedConfig<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = smtpCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    smtpCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  smtpCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

/**
 * Invalidate the in-memory SMTP cache.
 * Call this after the admin saves new SMTP config so the
 * next sendEmail() picks up the fresh values.
 */
export function invalidateSmtpCache(): void {
  smtpCache.clear();
}

// ============================================================
// Config read from SystemConfig table
// ============================================================

/**
 * Read SMTP config from the database (with 5-min memory cache).
 * Falls back to process.env.* variables if no DB config exists.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const cached = getCached<SmtpConfig>('smtp');
  if (cached) return cached;

  // Try DB first
  if (isDbAvailable() && db && hasModel('systemConfig')) {
    const row = await safeDbQuery(() =>
      db!.systemConfig.findUnique({ where: { key: 'smtp' } })
    );

    if (row) {
      try {
        const parsed = JSON.parse(row.config) as SmtpConfig;
        setCache('smtp', parsed);
        return parsed;
      } catch {
        // Bad JSON — fall through to env vars
      }
    }
  }

  // Fallback to process.env variables
  if (process.env.SMTP_HOST) {
    const envConfig: SmtpConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || 'noreply@fovi.ai',
    };
    setCache('smtp', envConfig);
    return envConfig;
  }

  return null;
}

// ============================================================
// Transporter
// ============================================================

let _transporter: nodemailer.Transporter | null = null;
let _transporterConfig: string | null = null; // serialized config key to detect changes

async function getTransporter(): Promise<nodemailer.Transporter | null> {
  const config = await getSmtpConfig();
  if (!config) return null;

  const configKey = `${config.host}:${config.port}:${config.user}`;
  if (_transporter && _transporterConfig === configKey) return _transporter;

  _transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
  _transporterConfig = configKey;

  return _transporter;
}

// ============================================================
// Public API
// ============================================================

/**
 * Check whether email (SMTP) is configured — looks at both DB and env vars.
 */
export async function isEmailConfigured(): Promise<boolean> {
  const config = await getSmtpConfig();
  return !!config;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ success: boolean }> {
  const transporter = await getTransporter();
  if (!transporter) {
    console.warn('[Email] SMTP not configured — email sending skipped.');
    return { success: true };
  }

  try {
    const config = await getSmtpConfig();
    const from = config?.from || 'noreply@fovi.ai';
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { success: true };
  } catch (err) {
    console.warn('[Email] Failed to send email:', err instanceof Error ? err.message : err);
    return { success: true }; // Don't expose email failures to the user
  }
}
