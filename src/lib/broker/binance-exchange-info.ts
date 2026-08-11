// ============================================================
// Binance Exchange Info Cache
// Caches exchange info (lot size / tick size) for 24 hours
// to format quantities and prices per-symbol accurately.
// ============================================================

interface SymbolFilter {
  filterType: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
}

interface SymbolInfo {
  symbol: string;
  filters: SymbolFilter[];
}

let exchangeInfo: Map<string, SymbolInfo> | null = null;
let exchangeInfoExpiry = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function getBinanceSymbolInfo(symbol: string): Promise<SymbolInfo | null> {
  if (!exchangeInfo || Date.now() > exchangeInfoExpiry) {
    await refreshExchangeInfo();
  }
  return exchangeInfo?.get(symbol.toUpperCase()) || null;
}

export async function getStepSize(symbol: string): Promise<number> {
  const info = await getBinanceSymbolInfo(symbol);
  const lotFilter = info?.filters?.find(f => f.filterType === 'LOT_SIZE');
  return lotFilter?.stepSize ? parseFloat(lotFilter.stepSize) : 0.00000001;
}

export async function getTickSize(symbol: string): Promise<number> {
  const info = await getBinanceSymbolInfo(symbol);
  const priceFilter = info?.filters?.find(f => f.filterType === 'PRICE_FILTER');
  return priceFilter?.tickSize ? parseFloat(priceFilter.tickSize) : 0.01;
}

/** Format quantity according to Binance step size */
export async function formatBinanceQty(symbol: string, qty: number): Promise<string> {
  const step = await getStepSize(symbol);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return qty.toFixed(decimals);
}

/** Format price according to Binance tick size */
export async function formatBinancePrice(symbol: string, price: number): Promise<string> {
  const tick = await getTickSize(symbol);
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)));
  return price.toFixed(decimals);
}

async function refreshExchangeInfo() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const data = await res.json();
    exchangeInfo = new Map();
    for (const s of data.symbols || []) {
      exchangeInfo.set(s.symbol, s);
    }
    exchangeInfoExpiry = Date.now() + CACHE_DURATION;
    console.log(`[Binance] Cached ${exchangeInfo.size} symbols from exchangeInfo`);
  } catch (e) {
    console.warn('[Binance] Failed to fetch exchangeInfo:', e);
    if (!exchangeInfo) exchangeInfo = new Map(); // Prevent retries on every call
  }
}
