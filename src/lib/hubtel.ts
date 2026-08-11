import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

// ============================================================
// Types
// ============================================================

export interface HubtelSmsConfig {
  clientId: string;
  clientSecret: string;
  senderName: string;
}

export interface HubtelPaymentConfig {
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  callbackUrl: string;
}

interface CachedConfig<T> {
  data: T;
  expiresAt: number;
}

// ============================================================
// In-memory config cache (5 min TTL)
// ============================================================

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const configCache = new Map<string, CachedConfig<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = configCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    configCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  configCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// ============================================================
// Config read/write from SystemConfig table
// ============================================================

/**
 * Read Hubtel SMS config from the database (with 5-min memory cache).
 */
export async function getHubtelSmsConfig(): Promise<HubtelSmsConfig | null> {
  const cached = getCached<HubtelSmsConfig>('hubtel_sms');
  if (cached) return cached;

  if (!isDbAvailable() || !db || !hasModel('systemConfig')) return null;

  const row = await safeDbQuery(() =>
    db!.systemConfig.findUnique({ where: { key: 'hubtel_sms' } })
  );

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.config) as HubtelSmsConfig;
    setCache('hubtel_sms', parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read Hubtel Payment config from the database (with 5-min memory cache).
 */
export async function getHubtelPaymentConfig(): Promise<HubtelPaymentConfig | null> {
  const cached = getCached<HubtelPaymentConfig>('hubtel_payment');
  if (cached) return cached;

  if (!isDbAvailable() || !db || !hasModel('systemConfig')) return null;

  const row = await safeDbQuery(() =>
    db!.systemConfig.findUnique({ where: { key: 'hubtel_payment' } })
  );

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.config) as HubtelPaymentConfig;
    setCache('hubtel_payment', parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save Hubtel SMS config to the database and update cache.
 */
export async function saveHubtelSmsConfig(config: HubtelSmsConfig): Promise<void> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
    throw new Error('Database is not available');
  }

  await db.systemConfig.upsert({
    where: { key: 'hubtel_sms' },
    create: { key: 'hubtel_sms', config: JSON.stringify(config) },
    update: { config: JSON.stringify(config) },
  });

  setCache('hubtel_sms', config);
}

/**
 * Save Hubtel Payment config to the database and update cache.
 */
export async function saveHubtelPaymentConfig(config: HubtelPaymentConfig): Promise<void> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
    throw new Error('Database is not available');
  }

  await db.systemConfig.upsert({
    where: { key: 'hubtel_payment' },
    create: { key: 'hubtel_payment', config: JSON.stringify(config) },
    update: { config: JSON.stringify(config) },
  });

  setCache('hubtel_payment', config);
}

// ============================================================
// SMS API
// ============================================================

const HUBTEL_SMS_URL = 'https://api.hubtel.com/v1/messages/send';

/**
 * Send an SMS via the Hubtel API.
 * Returns { success, messageId?, error? }.
 */
export async function sendSms(
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = await getHubtelSmsConfig();
  if (!config) {
    return { success: false, error: 'Hubtel SMS is not configured. Please set up the SMS integration in admin settings.' };
  }

  if (!config.clientId || !config.clientSecret) {
    return { success: false, error: 'Hubtel SMS credentials are incomplete.' };
  }

  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await fetch(HUBTEL_SMS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.senderName || 'FoviAI',
        to: phoneNumber,
        content: message,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        messageId: data.messageId || data.id,
      };
    }

    return {
      success: false,
      error: data.message || data.description || `Hubtel API error (${response.status})`,
    };
  } catch (err) {
    console.error('[Hubtel SMS] Request failed:', err instanceof Error ? err.message : err);
    return { success: false, error: 'Failed to send SMS. Please try again later.' };
  }
}

// ============================================================
// Payment / Invoice API
// ============================================================

const HUBTEL_INVOICE_URL = 'https://pay.hubtel.com/invoices';

export interface CreateInvoiceOptions {
  totalAmount: number;
  description: string;
  clientReference: string;
  customer: {
    email?: string;
    phoneNumber?: string;
    name?: string;
  };
  callbackUrl?: string;
  cancelUrl?: string;
  returnUrl?: string;
}

/**
 * Create a Hubtel payment invoice.
 * Returns { success, invoiceUrl?, invoiceId?, error? }.
 */
export async function createPaymentInvoice(
  options: CreateInvoiceOptions
): Promise<{ success: boolean; invoiceUrl?: string; invoiceId?: string; response?: unknown; error?: string }> {
  const config = await getHubtelPaymentConfig();
  if (!config) {
    return { success: false, error: 'Hubtel Payment is not configured. Please set up the payment integration in admin settings.' };
  }

  if (!config.clientId || !config.clientSecret) {
    return { success: false, error: 'Hubtel Payment credentials are incomplete.' };
  }

  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const callbackUrl = options.callbackUrl || config.callbackUrl;

    const body = {
      invoice: {
        total_amount: options.totalAmount,
        description: options.description,
        callback_url: callbackUrl,
        cancel_url: options.cancelUrl,
        return_url: options.returnUrl,
        client_reference: options.clientReference,
      },
      customer: {
        email: options.customer.email,
        phone_number: options.customer.phoneNumber,
        name: options.customer.name,
      },
    };

    const response = await fetch(HUBTEL_INVOICE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        invoiceUrl: data.response?.checkout_url || data.checkout_url,
        invoiceId: data.response?.invoice_id || data.invoice_id,
        response: data,
      };
    }

    return {
      success: false,
      error: data.message || data.description || `Hubtel API error (${response.status})`,
      response: data,
    };
  } catch (err) {
    console.error('[Hubtel Payment] Invoice creation failed:', err instanceof Error ? err.message : err);
    return { success: false, error: 'Failed to create payment invoice. Please try again later.' };
  }
}

/**
 * Check the status of a Hubtel payment invoice.
 */
export async function checkPaymentStatus(
  invoiceId: string
): Promise<{ success: boolean; status?: string; response?: unknown; error?: string }> {
  const config = await getHubtelPaymentConfig();
  if (!config) {
    return { success: false, error: 'Hubtel Payment is not configured.' };
  }

  if (!config.clientId || !config.clientSecret) {
    return { success: false, error: 'Hubtel Payment credentials are incomplete.' };
  }

  try {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await fetch(`${HUBTEL_INVOICE_URL}/${invoiceId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        status: data.response?.status || data.status,
        response: data,
      };
    }

    return {
      success: false,
      error: data.message || data.description || `Hubtel API error (${response.status})`,
    };
  } catch (err) {
    console.error('[Hubtel Payment] Status check failed:', err instanceof Error ? err.message : err);
    return { success: false, error: 'Failed to check payment status.' };
  }
}
