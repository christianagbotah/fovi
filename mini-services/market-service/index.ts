// ============================================================
// Market Data WebSocket Service
// Phase 2B: provider prices are never modified and synthetic fallback
// is always explicitly marked _realData=false.
// ============================================================

import { createServer } from 'http'
import { Server } from 'socket.io'

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network',
  UNI: 'uniswap', ATOM: 'cosmos', NEAR: 'near', APT: 'aptos',
  ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', SHIB: 'shiba-inu', TON: 'the-open-network',
}
const CRYPTO_SYMBOLS = Object.keys(COINGECKO_IDS)
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP', 'EURJPY', 'GBPJPY']
const COMMODITY_SYMBOLS = ['XAUUSD', 'XAGUSD', 'USOIL', 'NATGAS', 'XPTUSD']
const STOCK_SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'INTC', 'CRM', 'ORCL', 'JPM', 'V', 'WMT', 'DIS', 'BA', 'PYPL', 'UBER', 'COIN']
const INDEX_SYMBOLS = ['US30', 'NAS100', 'SPX500', 'FTSE100', 'DAX40']

const FOREX_MAP: Record<string, { base: string; invert?: boolean }> = {
  EURUSD: { base: 'EUR' }, GBPUSD: { base: 'GBP' }, USDJPY: { base: 'JPY', invert: true },
  AUDUSD: { base: 'AUD' }, USDCAD: { base: 'CAD', invert: true }, NZDUSD: { base: 'NZD' },
  USDCHF: { base: 'CHF', invert: true }, EURGBP: { base: 'GBP', invert: true },
  EURJPY: { base: 'JPY', invert: true }, GBPJPY: { base: 'JPY', invert: true },
}
const FINNHUB_MAP: Record<string, string> = {
  US30: '.DJI', NAS100: '.NDX', SPX500: '.INX', FTSE100: '.FTSE', DAX40: '.GDAXI',
}
const SYMBOL_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink', MATIC: 'Polygon', UNI: 'Uniswap', ATOM: 'Cosmos', NEAR: 'NEAR Protocol', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism', PEPE: 'Pepe', SHIB: 'Shiba Inu', TON: 'Toncoin',
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD', USDCAD: 'USD/CAD', NZDUSD: 'NZD/USD', USDCHF: 'USD/CHF', EURGBP: 'EUR/GBP', EURJPY: 'EUR/JPY', GBPJPY: 'GBP/JPY',
  XAUUSD: 'Gold', XAGUSD: 'Silver', USOIL: 'US Crude Oil', NATGAS: 'Natural Gas', XPTUSD: 'Platinum',
  AAPL: 'Apple Inc.', GOOGL: 'Alphabet Inc.', MSFT: 'Microsoft Corp.', AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.', META: 'Meta Platforms', NFLX: 'Netflix Inc.', AMD: 'Advanced Micro Devices', INTC: 'Intel Corp.', CRM: 'Salesforce Inc.', ORCL: 'Oracle Corp.', JPM: 'JPMorgan Chase', V: 'Visa Inc.', WMT: 'Walmart Inc.', DIS: 'Walt Disney Co.', BA: 'Boeing Co.', PYPL: 'PayPal Holdings', UBER: 'Uber Technologies', COIN: 'Coinbase Global',
  US30: 'US 30 (Dow Jones)', NAS100: 'NASDAQ 100', SPX500: 'S&P 500', FTSE100: 'FTSE 100', DAX40: 'DAX 40',
}
const DEMO_BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5, TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4, CRM: 272, ORCL: 145, JPM: 205, V: 285, WMT: 168, DIS: 112, BA: 178, PYPL: 65, UBER: 78, COIN: 225,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58, DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8, MATIC: 0.72, UNI: 11.5, ATOM: 9.2, NEAR: 7.8, APT: 9.5, ARB: 1.15, OP: 2.45, PEPE: 0.000012, SHIB: 0.000025, TON: 6.8,
  EURUSD: 1.085, GBPUSD: 1.272, USDJPY: 154.5, AUDUSD: 0.665, USDCAD: 1.365, NZDUSD: 0.615, USDCHF: 0.875, EURGBP: 0.853, EURJPY: 167.8, GBPJPY: 196.5,
  XAUUSD: 2385, XAGUSD: 28.5, USOIL: 78.5, NATGAS: 2.85, XPTUSD: 980,
  US30: 39500, NAS100: 18350, SPX500: 5350, FTSE100: 8200, DAX40: 18400,
}
const ALL_SYMBOLS = Object.keys(DEMO_BASE_PRICES)

function getAssetType(symbol: string): string {
  if (FOREX_PAIRS.includes(symbol)) return 'forex'
  if (CRYPTO_SYMBOLS.includes(symbol)) return 'crypto'
  if (INDEX_SYMBOLS.includes(symbol)) return 'index'
  if (COMMODITY_SYMBOLS.includes(symbol)) return 'commodity'
  return 'stock'
}

interface CachedPrice {
  price: number
  change: number
  changePercent: number
  volume: number
  high24h: number
  low24h: number
  _realData: true
}
const realPriceCache = new Map<string, CachedPrice>()

async function fetchCryptoPrices() {
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&sparkline=false&price_change_percentage=24h'
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const data = await res.json() as Array<{ symbol?: string; current_price?: number; price_change_24h?: number; price_change_percentage_24h?: number; total_volume?: number; high_24h?: number; low_24h?: number }>
    for (const coin of data) {
      const symbol = coin.symbol?.toUpperCase()
      if (!symbol || !COINGECKO_IDS[symbol] || !Number.isFinite(coin.current_price) || (coin.current_price ?? 0) <= 0) continue
      const price = coin.current_price as number
      realPriceCache.set(symbol, { price, change: coin.price_change_24h ?? 0, changePercent: coin.price_change_percentage_24h ?? 0, volume: coin.total_volume ?? 0, high24h: coin.high_24h ?? price, low24h: coin.low_24h ?? price, _realData: true })
    }
  } catch (err) { console.warn('[market] CoinGecko failed:', err instanceof Error ? err.message : err) }
}

async function fetchForexPrices() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`)
    const data = await res.json() as { rates?: Record<string, number> }
    const rates = data.rates
    if (!rates) return
    for (const [symbol, mapping] of Object.entries(FOREX_MAP)) {
      const rate = rates[mapping.base]
      const price = mapping.invert ? rate : (rate && rate > 0 ? 1 / rate : 0)
      if (!price || price <= 0) continue
      realPriceCache.set(symbol, { price, change: 0, changePercent: 0, volume: 0, high24h: price, low24h: price, _realData: true })
    }
  } catch (err) { console.warn('[market] Forex provider failed:', err instanceof Error ? err.message : err) }
}

async function fetchMetalPrices() {
  try {
    const res = await fetch('https://api.metals.live/v1/spot', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`metals.live HTTP ${res.status}`)
    const data = await res.json() as Array<{ metal?: string; price?: number; change?: number; change_percent?: number }>
    if (!Array.isArray(data)) return
    for (const item of data) {
      const symbol = item.metal?.toLowerCase() === 'gold' ? 'XAUUSD' : item.metal?.toLowerCase() === 'silver' ? 'XAGUSD' : null
      if (!symbol || !Number.isFinite(item.price) || (item.price ?? 0) <= 0) continue
      const price = item.price as number
      realPriceCache.set(symbol, { price, change: item.change ?? 0, changePercent: item.change_percent ?? 0, volume: 0, high24h: price, low24h: price, _realData: true })
    }
  } catch (err) { console.warn('[market] Metals provider failed:', err instanceof Error ? err.message : err) }
}

async function fetchStockPrices() {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return
  const tickers = [...STOCK_SYMBOLS, ...INDEX_SYMBOLS]
  for (let i = 0; i < tickers.length; i += 5) {
    const rows = await Promise.all(tickers.slice(i, i + 5).map(async (symbol) => {
      try {
        const q = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(FINNHUB_MAP[symbol] || symbol)}&token=${apiKey}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
        if (!q.ok) return null
        const row = await q.json() as { c?: number; h?: number; l?: number; pc?: number }
        if (!Number.isFinite(row.c) || (row.c ?? 0) <= 0) return null
        return { symbol, row }
      } catch { return null }
    }))
    for (const value of rows) {
      if (!value) continue
      const price = value.row.c as number
      const previous = value.row.pc ?? price
      const change = price - previous
      realPriceCache.set(value.symbol, { price, change, changePercent: previous > 0 ? change / previous * 100 : 0, volume: 0, high24h: value.row.h ?? price, low24h: value.row.l ?? price, _realData: true })
    }
    if (i + 5 < tickers.length) await new Promise(resolve => setTimeout(resolve, 1100))
  }
}

const demoPriceCache = new Map<string, { price: number; ts: number }>()
function demoPrice(base: number): number {
  const now = Date.now()
  const key = String(base)
  const cached = demoPriceCache.get(key)
  if (cached && now - cached.ts < 2000) return cached.price
  const seed = Math.sin(now / 5000 + base) * 10000
  const rand = seed - Math.floor(seed)
  const price = Math.max(0.01, Math.round((base + (rand - 0.48) * 0.004 * base) * 100) / 100)
  demoPriceCache.set(key, { price, ts: now })
  return price
}

interface PriceTick {
  symbol: string; name: string; assetType: string; price: number; change: number; changePercent: number;
  volume: number; high24h: number; low24h: number; timestamp: number; _realData: boolean
}
function getPriceTick(symbol: string): PriceTick {
  const cached = realPriceCache.get(symbol)
  if (cached) {
    return { symbol, name: SYMBOL_NAMES[symbol] || symbol, assetType: getAssetType(symbol), price: cached.price, change: cached.change, changePercent: cached.changePercent, volume: cached.volume, high24h: cached.high24h, low24h: cached.low24h, timestamp: Date.now(), _realData: true }
  }
  const price = demoPrice(DEMO_BASE_PRICES[symbol] || 100)
  return { symbol, name: SYMBOL_NAMES[symbol] || symbol, assetType: getAssetType(symbol), price, change: 0, changePercent: 0, volume: 0, high24h: price, low24h: price, timestamp: Date.now(), _realData: false }
}

const HOST = '127.0.0.1'
const PORT = 3003
const marketStartTime = Date.now()
const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'fovi-market-service', port: PORT, uptime: Math.floor((Date.now() - marketStartTime) / 1000), symbolsTotal: ALL_SYMBOLS.length, symbolsWithRealData: realPriceCache.size }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found')
})
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] }, pingTimeout: 60000, pingInterval: 25000 })

io.on('connection', (socket) => {
  socket.emit('prices:update', { prices: ALL_SYMBOLS.map(getPriceTick), timestamp: Date.now() })
  socket.on('market:subscribe', (data: { symbol: string }) => socket.join(`market:${data.symbol}`))
  socket.on('market:subscribe:all', () => socket.join('market:all'))
  socket.on('market:unsubscribe', (data: { symbol: string }) => socket.leave(`market:${data.symbol}`))
  socket.on('market:unsubscribe:all', () => socket.leave('market:all'))
  socket.join('market:all')
})

setInterval(() => {
  const ticks = ALL_SYMBOLS.map(getPriceTick)
  for (const tick of ticks) io.to(`market:${tick.symbol}`).emit('price:update', tick)
  io.to('market:all').emit('prices:update', { prices: ticks, timestamp: Date.now() })
}, 2000)
setInterval(() => { void fetchCryptoPrices() }, 30_000)
setInterval(() => { void fetchForexPrices() }, 60_000)
setInterval(() => { void fetchMetalPrices() }, 60_000)
setInterval(() => { void fetchStockPrices() }, 300_000)

async function startup() {
  await Promise.all([fetchCryptoPrices(), fetchForexPrices(), fetchMetalPrices(), fetchStockPrices()])
  httpServer.listen(PORT, HOST, () => console.log(`[market] Ready on ${HOST}:${PORT}; ${realPriceCache.size}/${ALL_SYMBOLS.length} real`))
}
startup().catch(err => {
  console.error('[market] Startup error:', err)
  httpServer.listen(PORT, HOST, () => console.log('[market] Running with explicitly synthetic fallback ticks'))
})
process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })