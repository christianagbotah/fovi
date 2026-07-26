'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { MarketSymbol } from '@/lib/types'

interface UseMarketSocketReturn {
  prices: MarketSymbol[]
  connected: boolean
  reconnect: () => void
}

export function useMarketSocket(): UseMarketSocketReturn {
  const [prices, setPrices] = useState<MarketSymbol[]>([])
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('market:subscribe:all')
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('prices:update', (data: { prices: MarketSymbol[]; timestamp: number }) => {
      setPrices(data.prices)
    })

    socket.on('price:update', (tick: MarketSymbol) => {
      setPrices(prev => {
        const idx = prev.findIndex(p => p.symbol === tick.symbol)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = tick
          return next
        }
        return [...prev, tick]
      })
    })
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (socketRef.current) {
        socketRef.current.emit('market:unsubscribe:all')
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [connect])

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setConnected(false)
    connect()
  }, [connect])

  return { prices, connected, reconnect }
}
