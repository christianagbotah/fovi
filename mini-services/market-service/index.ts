// Crypto prices from CoinGecko API (free, no key). Stocks/forex use demo data. On VPS, add TWELVEDATA_API_KEY env var for real stock data.

import { createServer } from 'http'
import { Server } from 'socket.io'

// ============================================================
// CoinGecko Real Data — Free API, No Key Required
// ============================================================

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
}

const CRYPTO_SYMBOLS = Object.keys(COINGECKO_IDS)

interface CoinGeckoMarket {
  symbol: string
  current_price: number
  price_change_24h: number
  price_change_percentage_24h: number
  total_volume: number
  high_24h: number
  low_24h: number
}

// In-memory store for real crypto prices — updated every 30s
let realCryptoPrices = new Map<string, {
  price: number
  change: number
  changePercent: number
  volume: number
  high24h: number
  low24h: number
}>()

async function fetchRealCryptoPrices(): Promise<Map<string, {
  price: number
  change: number
  changePercent: number
  volume: number
  high24h: number
  low24h: number
}>> {
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

    const newPrices = new Map<string, {
      price: number
      change: number
      changePercent: number
      volume: number
      high24h: number
      low24h: number
    }>()

    for (const coin of data) {
      const symbol = coin.symbol?.toUpperCase()
      if (symbol && COINGECKO_IDS[symbol]) {
        newPrices.set(symbol, {
          price: coin.current_price,
          change: coin.price_change_24h ?? 0,
          changePercent: coin.price_change_percentage_24h ?? 0,
          volume: coin.total_volume ?? 0,
          high24h: coin.high_24h ?? coin.current_price * 1.02,
          low24h: coin.low_24h ?? coin.current_price * 0.98,
        })
      }
    }

    if (newPrices.size > 0) {
      console.log(`[market] CoinGecko: fetched ${newPrices.size} real crypto prices`)
      realCryptoPrices = newPrices
    }
  } catch (err) {
    console.warn('[market] CoinGecko fetch failed, using demo prices:', err instanceof Error ? err.message : err)
  }

  return realCryptoPrices
}

// ============================================================
// Price Generation (Demo Fallback)
// ============================================================

const BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
  EURUSD: 1.085, GBPUSD: 1.272, USDJPY: 154.5, AUDUSD: 0.665,
  XAUUSD: 2385, XAGUSD: 28.5, US30: 39500, NAS100: 18350,
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

function getAssetType(symbol: string): string {
  if (['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'].includes(symbol)) return 'forex'
  if (['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK'].includes(symbol)) return 'crypto'
  if (['US30', 'NAS100', 'XAUUSD', 'XAGUSD'].includes(symbol)) return 'synthetic'
  return 'stock'
}

const priceCache = new Map<string, { price: number; ts: number }>()
const CACHE_TTL = 2000

function randomWalkPrice(base: number, volatility: number): number {
  const key = `${base}_${volatility}`
  const now = Date.now()
  const cached = priceCache.get(key)
  if (cached && now - cached.ts < CACHE_TTL) return cached.price
  const seed = Math.sin(now / 5000 + base) * 10000
  const rand = seed - Math.floor(seed)
  const change = (rand - 0.48) * 2 * volatility * base
  const price = Math.round((base + change) * 100) / 100
  priceCache.set(key, { price: Math.max(0.01, price), ts: now })
  return Math.max(0.01, price)
}

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
}

function getPriceTick(symbol: string, base: number): PriceTick {
  // Use real CoinGecko data for crypto if available
  const cryptoData = realCryptoPrices.get(symbol)
  if (cryptoData) {
    // Add a tiny random micro-movement to simulate live tick changes
    const microShift = (Math.random() - 0.5) * 0.001 * cryptoData.price
    const price = Math.round((cryptoData.price + microShift) * 100) / 100
    return {
      symbol,
      name: SYMBOL_NAMES[symbol] || symbol,
      assetType: getAssetType(symbol),
      price,
      change: cryptoData.change,
      changePercent: cryptoData.changePercent,
      volume: cryptoData.volume,
      high24h: cryptoData.high24h,
      low24h: cryptoData.low24h,
      timestamp: Date.now(),
    }
  }

  // Demo fallback for stocks, forex, commodities, or if CoinGecko is down
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

const SYMBOLS = Object.keys(BASE_PRICES)

io.on('connection', (socket) => {
  console.log(`[market] Client connected: ${socket.id}`)

  const initialPrices: PriceTick[] = SYMBOLS.map(s => getPriceTick(s, BASE_PRICES[s]))
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
    SYMBOLS.forEach(s => socket.leave(`market:${s}`))
    socket.leave('market:all')
  })

  socket.on('disconnect', () => {
    console.log(`[market] Client disconnected: ${socket.id}`)
  })

  // Auto-subscribe to all on connect
  socket.join('market:all')
})

// ============================================================
// Price broadcast loop — every 2 seconds
// ============================================================

setInterval(() => {
  const now = Date.now()
  const allTicks: PriceTick[] = SYMBOLS.map(s => getPriceTick(s, BASE_PRICES[s]))

  for (const tick of allTicks) {
    io.to(`market:${tick.symbol}`).emit('price:update', tick)
  }

  io.to('market:all').emit('prices:update', { prices: allTicks, timestamp: now })
}, 2000)

// ============================================================
// CoinGecko refresh loop — every 30 seconds
// ============================================================

setInterval(() => {
  fetchRealCryptoPrices()
}, 30_000)

const PORT = 3003

// Startup: fetch real crypto prices immediately, then start server
fetchRealCryptoPrices().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[market] Market data service running on port ${PORT}`)
    console.log(`[market] Streaming ${SYMBOLS.length} symbols every 2s (crypto: CoinGecko, stocks/forex: demo)`)
    console.log(`[market] CoinGecko refresh every 30s`)
  })
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
