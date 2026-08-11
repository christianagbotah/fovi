// ============================================================
// Market Data WebSocket Service
// ------------------------------------------------------------
// Real-time price streaming via Socket.io with real API data:
//   - Crypto:    CoinGecko free API (no key) — refreshed every 30s
//   - Forex:     ExchangeRate-API (free, no key) — refreshed every 60s
//   - Metals:    metals.live API (free, no key) — refreshed every 60s
//   - Stocks:    Finnhub free API (FINNHUB_API_KEY env var) — every 5min
// If any API fails, graceful fallback to demo prices.
// All cached — the 2s broadcast loop uses cached data with micro-movements.
// ============================================================

import { createServer } from 'http'
import { Server } from 'socket.io'

// ============================================================
// Symbol definitions
// ============================================================

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
}
const CRYPTO_SYMBOLS = Object.keys(COINGECKO_IDS)

const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']
const METAL_SYMBOLS = ['XAUUSD', 'XAGUSD']
const STOCK_SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'INTC']
const INDEX_SYMBOLS = ['US30', 'NAS100']

const FOREX_MAP: Record<string, { base: string; quote: string; invert?: boolean }> = {
  EURUSD: { base: 'EUR', quote: 'USD' },
  GBPUSD: { base: 'GBP', quote: 'USD' },
  USDJPY: { base: 'JPY', quote: 'USD', invert: true },
  AUDUSD: { base: 'AUD', quote: 'USD' },
}

const FINNHUB_MAP: Record<string, string> = {
  US30: '.DJI',
  NAS100: '.NDX',
}

const SYMBOL_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc.', GOOGL: 'Alphabet Inc.', MSFT: 'Microsoft Corp.',
  AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.',
  META: 'Meta Platforms', NFLX: 'Netflix Inc.', AMD: 'Advanced Micro Devices',
  INTC: 'Intel Corp.', BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink',
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD', XAUUSD: 'Gold', XAGUSD: 'Silver',
  US30: 'US 30 Index', NAS100: 'NASDAQ 100',
}

const DEMO_BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
  EURUSD: 1.085, GBPUSD: 1.272, USDJPY: 154.5, AUDUSD: 0.665,
  XAUUSD: 2385, XAGUSD: 28.5, US30: 39500, NAS100: 18350,
}

const ALL_SYMBOLS = Object.keys(DEMO_BASE_PRICES)

function getAssetType(symbol: string): string {
  if (FOREX_PAIRS.includes(symbol)) return 'forex'
  if (CRYPTO_SYMBOLS.includes(symbol)) return 'crypto'
  if (INDEX_SYMBOLS.includes(symbol)) return 'index'
  if (METAL_SYMBOLS.includes(symbol)) return 'commodity'
  return 'stock'
}

// ============================================================
// Real price cache — updated periodically, used by broadcast loop
// ============================================================

interface CachedPrice {
  price: number
  change: number
  changePercent: number
  volume: number
  high24h: number
  low24h: number
  _realData: boolean
}

const realPriceCache = new Map<string, CachedPrice>()

// ============================================================
// 1. CoinGecko — Crypto (free, no key)
// ============================================================

interface CoinGeckoMarket {
  symbol: string
  current_price: number
  price_change_24h: number
  price_change_percentage_24h: number
  total_volume: number
  high_24h: number
  low_24h: number
}

async function fetchCryptoPrices() {
  try {
    const url =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=20&page=1' +
      '&sparkline=false&price_change_percentage=24h'
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const data: CoinGeckoMarket[] = await res.json()

    let count = 0
    for (const coin of data) {
      const sym = coin.symbol?.toUpperCase()
      if (sym && COINGECKO_IDS[sym]) {
        realPriceCache.set(sym, {
          price: coin.current_price,
          change: coin.price_change_24h ?? 0,
          changePercent: coin.price_change_percentage_24h ?? 0,
          volume: coin.total_volume ?? 0,
          high24h: coin.high_24h ?? coin.current_price * 1.02,
          low24h: coin.low_24h ?? coin.current_price * 0.98,
          _realData: true,
        })
        count++
      }
    }
    console.log(`[market] CoinGecko: ${count} real crypto prices`)
  } catch (err) {
    console.warn('[market] CoinGecko failed:', err instanceof Error ? err.message : err)
  }
}

// ============================================================
// 2. ExchangeRate-API — Forex (free, no key)
// ============================================================

async function fetchForexPrices() {
  try {
    const url = 'https://open.er-api.com/v6/latest/USD'
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`)
    const data = await res.json()
    const rates: Record<string, number> = data?.rates
    if (!rates) throw new Error('No rates in response')

    let count = 0
    for (const [symbol, mapping] of Object.entries(FOREX_MAP)) {
      let price: number
      if (mapping.invert) {
        price = rates[mapping.base] ?? 0
      } else {
        const rate = rates[mapping.base]
        price = rate && rate > 0 ? 1 / rate : 0
      }
      if (price > 0) {
        realPriceCache.set(symbol, {
          price,
          change: 0,
          changePercent: 0,
          volume: 0,
          high24h: price * 1.005,
          low24h: price * 0.995,
          _realData: true,
        })
        count++
      }
    }
    console.log(`[market] ExchangeRate-API: ${count} real forex prices`)
  } catch (err) {
    console.warn('[market] ExchangeRate-API failed:', err instanceof Error ? err.message : err)
  }
}

// ============================================================
// 3. metals.live — Gold/Silver (free, no key)
// ============================================================

interface MetalsLiveSpot {
  metal: string
  price: number
  prev_close: number
  change: number
  change_percent: number
}

async function fetchMetalPrices() {
  try {
    const url = 'https://api.metals.live/v1/spot'
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`metals.live HTTP ${res.status}`)
    const data: MetalsLiveSpot[] = await res.json()
    if (!Array.isArray(data)) throw new Error('Invalid response format')

    let count = 0
    for (const item of data) {
      const metal = item.metal?.toLowerCase()
      if (metal === 'gold') {
        realPriceCache.set('XAUUSD', {
          price: item.price, change: item.change ?? 0,
          changePercent: item.change_percent ?? 0, volume: 0,
          high24h: item.price * 1.01, low24h: item.price * 0.99,
          _realData: true,
        })
        count++
      } else if (metal === 'silver') {
        realPriceCache.set('XAGUSD', {
          price: item.price, change: item.change ?? 0,
          changePercent: item.change_percent ?? 0, volume: 0,
          high24h: item.price * 1.01, low24h: item.price * 0.99,
          _realData: true,
        })
        count++
      }
    }
    console.log(`[market] metals.live: ${count} real metal prices`)
  } catch (err) {
    console.warn('[market] metals.live failed:', err instanceof Error ? err.message : err)
  }
}

// ============================================================
// 4. Finnhub — Stocks & Indices (free API key required)
// ============================================================

interface FinnhubQuote {
  c: number; h: number; l: number; o: number; pc: number;
}

async function fetchStockPrices() {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) {
    console.log('[market] Finnhub: no FINNHUB_API_KEY, stocks use demo')
    return
  }

  const allTickers = [...STOCK_SYMBOLS, ...INDEX_SYMBOLS]
  const batchSize = 5
  let count = 0

  for (let i = 0; i < allTickers.length; i += batchSize) {
    const batch = allTickers.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(async (sym) => {
      const finnhubSym = FINNHUB_MAP[sym] || sym
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${apiKey}`
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`)
        const q: FinnhubQuote = await res.json()
        if (q.c > 0) {
          return { sym, c: q.c, h: q.h, l: q.l, pc: q.pc }
        }
      } catch (err) {
        console.warn(`[market] Finnhub ${sym} failed:`, err instanceof Error ? err.message : err)
      }
      return null
    }))

    for (const r of results) {
      if (r) {
        const change = r.c - r.pc
        const changePercent = r.pc > 0 ? (change / r.pc) * 100 : 0
        realPriceCache.set(r.sym, {
          price: r.c, change, changePercent, volume: 0,
          high24h: r.h || r.c * 1.01, low24h: r.l || r.c * 0.99,
          _realData: true,
        })
        count++
      }
    }

    // Rate-limit between batches
    if (i + batchSize < allTickers.length) {
      await new Promise(resolve => setTimeout(resolve, 1100))
    }
  }
  console.log(`[market] Finnhub: ${count} real stock/index prices`)
}

// ============================================================
// Demo price fallback (deterministic random walk)
// ============================================================

const demoPriceCache = new Map<string, { price: number; ts: number }>()
const DEMO_CACHE_TTL = 2000

function randomWalkPrice(base: number, volatility: number): number {
  const key = `${base}_${volatility}`
  const now = Date.now()
  const cached = demoPriceCache.get(key)
  if (cached && now - cached.ts < DEMO_CACHE_TTL) return cached.price
  const seed = Math.sin(now / 5000 + base) * 10000
  const rand = seed - Math.floor(seed)
  const change = (rand - 0.48) * 2 * volatility * base
  const price = Math.round((base + change) * 100) / 100
  const safePrice = Math.max(0.01, price)
  demoPriceCache.set(key, { price: safePrice, ts: now })
  return safePrice
}

// ============================================================
// Price tick generation — uses real cache, falls back to demo
// ============================================================

interface PriceTick {
  symbol: string
  name: string
  assetType: string
  price: number
  change: number
  changePercent: number
  volume: number
  high24h: number
  low24h: number
  timestamp: number
  _realData: boolean
}

function getPriceTick(symbol: string): PriceTick {
  const base = DEMO_BASE_PRICES[symbol] || 100
  const cached = realPriceCache.get(symbol)

  if (cached) {
    // Add micro-movement to simulate live tick
    const microShift = (Math.random() - 0.5) * 0.001 * cached.price
    const price = Math.round((cached.price + microShift) * 100) / 100
    return {
      symbol,
      name: SYMBOL_NAMES[symbol] || symbol,
      assetType: getAssetType(symbol),
      price,
      change: cached.change,
      changePercent: cached.changePercent,
      volume: cached.volume,
      high24h: cached.high24h,
      low24h: cached.low24h,
      timestamp: Date.now(),
      _realData: true,
    }
  }

  // Demo fallback
  const price = randomWalkPrice(base, 0.002)
  const prevPrice = randomWalkPrice(base, 0.003)
  const change = price - prevPrice
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] || symbol,
    assetType: getAssetType(symbol),
    price,
    change,
    changePercent: prevPrice > 0 ? (change / prevPrice) * 100 : 0,
    volume: Math.floor(Math.random() * 10000000),
    high24h: price * 1.02,
    low24h: price * 0.98,
    timestamp: Date.now(),
    _realData: false,
  }
}

// ============================================================
// Socket.io Server
// ============================================================

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`[market] Client connected: ${socket.id}`)

  const initialPrices: PriceTick[] = ALL_SYMBOLS.map(s => getPriceTick(s))
  socket.emit('prices:update', { prices: initialPrices, timestamp: Date.now() })

  socket.on('market:subscribe', (data: { symbol: string }) => {
    socket.join(`market:${data.symbol}`)
  })

  socket.on('market:subscribe:all', () => {
    socket.join('market:all')
  })

  socket.on('market:unsubscribe', (data: { symbol: string }) => {
    socket.leave(`market:${data.symbol}`)
  })

  socket.on('market:unsubscribe:all', () => {
    ALL_SYMBOLS.forEach(s => socket.leave(`market:${s}`))
    socket.leave('market:all')
  })

  socket.on('disconnect', () => {
    console.log(`[market] Client disconnected: ${socket.id}`)
  })

  socket.join('market:all')
})

// ============================================================
// Price broadcast loop — every 2 seconds (uses cached data)
// ============================================================

setInterval(() => {
  const now = Date.now()
  const allTicks: PriceTick[] = ALL_SYMBOLS.map(s => getPriceTick(s))

  for (const tick of allTicks) {
    io.to(`market:${tick.symbol}`).emit('price:update', tick)
  }

  io.to('market:all').emit('prices:update', { prices: allTicks, timestamp: now })
}, 2000)

// ============================================================
// Periodic refresh loops (separate intervals per source)
// ============================================================

// Crypto: every 30s
setInterval(() => { fetchCryptoPrices() }, 30_000)

// Forex: every 60s
setInterval(() => { fetchForexPrices() }, 60_000)

// Metals: every 60s
setInterval(() => { fetchMetalPrices() }, 60_000)

// Stocks/Indices: every 5 minutes
setInterval(() => { fetchStockPrices() }, 300_000)

// ============================================================
// Startup
// ============================================================

const PORT = 3003

async function startup() {
  console.log(`[market] Starting market data service on port ${PORT}`)
  console.log(`[market] Streaming ${ALL_SYMBOLS.length} symbols every 2s`)
  console.log(`[market] Data sources: CoinGecko (crypto, 30s), ExchangeRate-API (forex, 60s), metals.live (metals, 60s), Finnhub (stocks, 5min, requires FINNHUB_API_KEY)`)

  // Fetch all real data in parallel on startup
  await Promise.all([
    fetchCryptoPrices(),
    fetchForexPrices(),
    fetchMetalPrices(),
    fetchStockPrices(),
  ])

  httpServer.listen(PORT, () => {
    const realCount = realPriceCache.size
    console.log(`[market] Ready — ${realCount}/${ALL_SYMBOLS.length} symbols have real data, rest use demo`)
  })
}

startup().catch(err => {
  console.error('[market] Startup error:', err)
  httpServer.listen(PORT, () => {
    console.log(`[market] Running in demo-only mode (${err instanceof Error ? err.message : err})`)
  })
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
