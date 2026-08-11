// ============================================================
// Broker API Rate Limiter
// Simple per-broker rate limiter to avoid API bans.
// Uses a minimum interval between consecutive calls to each broker.
// ============================================================

interface BrokerRateLimit {
  lastCall: number;
  minInterval: number; // ms between calls
}

const brokerLimits = new Map<string, BrokerRateLimit>();

const DEFAULT_INTERVALS: Record<string, number> = {
  binance: 500,  // Binance: 1200 req/min weight → ~500ms between calls to be safe
  okx: 200,      // OKX: 20 req/2s → 200ms
  alpaca: 250,   // Alpaca: 200 req/min → ~300ms
};

/**
 * Enforces a minimum interval between consecutive API calls to a broker.
 * Call this at the start of every public broker method that makes HTTP calls.
 * Will sleep if called too soon after the previous call.
 */
export async function brokerRateLimit(brokerName: string): Promise<void> {
  const interval = DEFAULT_INTERVALS[brokerName] || 500;
  const entry = brokerLimits.get(brokerName);
  const now = Date.now();

  if (entry && now - entry.lastCall < interval) {
    const waitMs = interval - (now - entry.lastCall);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  brokerLimits.set(brokerName, { lastCall: Date.now(), minInterval: interval });
}
