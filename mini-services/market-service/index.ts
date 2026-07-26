import { createServer } from 'http'
import { Server } from 'socket.io'

// ============================================================
// Price Generation (copied — mini-service is independent)
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

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[market] Market data service running on port ${PORT}`)
  console.log(`[market] Streaming ${SYMBOLS.length} symbols every 2s`)
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
