// Deterministic random walk for consistent demo prices within a tick
const priceCache = new Map<string, { price: number; ts: number }>();
const CACHE_TTL = 3000; // 3 seconds

export function randomWalkPrice(base: number, volatility: number): number {
  const key = `${base}_${volatility}`;
  const now = Date.now();
  const cached = priceCache.get(key);
  
  if (cached && now - cached.ts < CACHE_TTL) {
    return cached.price;
  }
  
  // Pseudo-random walk
  const seed = Math.sin(now / 5000 + base) * 10000;
  const rand = seed - Math.floor(seed); // 0-1
  const change = (rand - 0.48) * 2 * volatility * base;
  const price = Math.round((base + change) * 100) / 100;
  
  priceCache.set(key, { price: Math.max(0.01, price), ts: now });
  return Math.max(0.01, price);
}

export function formatPrice(price: number, symbol: string): string {
  const forexPairs = ['EURUSD', 'GBPUSD', 'AUDUSD'];
  const jpypairs = ['USDJPY'];
  const cryptoSmall = ['DOGE', 'XRP', 'ADA'];
  
  if (forexPairs.includes(symbol) || cryptoSmall.includes(symbol)) {
    return price.toFixed(4);
  }
  if (jpypairs.includes(symbol)) {
    return price.toFixed(2);
  }
  if (price >= 1000) {
    return price.toFixed(2);
  }
  return price.toFixed(2);
}

export function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${Math.abs(pnl).toFixed(2)}`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toString();
}

export function getSignalColor(direction: string): string {
  switch (direction) {
    case 'bullish': return 'text-emerald-500';
    case 'bearish': return 'text-red-500';
    default: return 'text-muted-foreground';
  }
}

export function getSignalIcon(direction: string): string {
  switch (direction) {
    case 'bullish': return 'TrendingUp';
    case 'bearish': return 'TrendingDown';
    default: return 'Minus';
  }
}

export function getSignalBgClass(direction: string): string {
  switch (direction) {
    case 'bullish': return 'bg-emerald-500/10 border-emerald-500/20';
    case 'bearish': return 'bg-red-500/10 border-red-500/20';
    default: return 'bg-muted border-border';
  }
}

export function getTimeframeMs(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  return map[tf] || 86400000;
}
