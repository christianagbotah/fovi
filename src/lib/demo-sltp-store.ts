/**
 * In-memory store for demo broker position SL/TP values.
 * When DB is unavailable, orders placed via the demo broker don't persist
 * SL/TP. This module bridges that gap by storing SL/TP in process memory.
 */

interface DemoSLTP {
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: string;
}

// Keyed by symbol → SL/TP data
const sltpStore = new Map<string, DemoSLTP>();

export function saveDemoPositionSLTP(
  symbol: string,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): void {
  sltpStore.set(symbol, {
    stopLoss: stopLoss ?? null,
    takeProfit: takeProfit ?? null,
    openedAt: new Date().toISOString(),
  });
}

export function loadDemoPositionSLTP(): Map<string, DemoSLTP> {
  return sltpStore;
}

export function removeDemoPositionSLTP(symbol: string): void {
  sltpStore.delete(symbol);
}
