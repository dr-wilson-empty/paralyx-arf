import { useEffect, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { NETWORK, NETWORK_ID } from '../config'
import { getFx, getFxHistory, getSolHistory, getSolUsd } from './rail'
import { connection } from './solana'
import { decodePythPrice } from './pyth'

export interface LivePrices {
  tryPerUsd: number | null
  solUsd: number | null
  fxSource: string | null
  updatedAt: number | null
}

export interface Point {
  t: number
  v: number
}

export type SolRange = '24h' | '7d' | '30d'

const RANGE_MS: Record<SolRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }
const SAMPLE_KEY = `paralyx:${NETWORK_ID}:pyth:sol-usd`

async function fetchSolUsd(): Promise<number | null> {
  const hermes = await getSolUsd().catch(() => null)
  if (hermes && hermes.solUsd > 0) return hermes.solUsd
  const info = await connection.getAccountInfo(new PublicKey(NETWORK.pythSolUsd))
  const decoded = info ? decodePythPrice(info.data) : null
  return decoded && decoded.price > 0 ? decoded.price : null
}

function readSamples(): Point[] {
  try {
    const raw = localStorage.getItem(SAMPLE_KEY)
    return raw ? (JSON.parse(raw) as Point[]) : []
  } catch {
    return []
  }
}

function addSample(value: number): void {
  const now = Date.now()
  const samples = readSamples().filter((point) => now - point.t < RANGE_MS['30d'])
  const last = samples[samples.length - 1]
  if (last && now - last.t < 60_000) return
  samples.push({ t: now, v: value })
  try {
    localStorage.setItem(SAMPLE_KEY, JSON.stringify(samples.slice(-4000)))
  } catch {
    return
  }
}

let shared: LivePrices = { tryPerUsd: null, solUsd: null, fxSource: null, updatedAt: null }
const listeners = new Set<(prices: LivePrices) => void>()
let timer: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  const [fx, solUsd] = await Promise.all([getFx().catch(() => null), fetchSolUsd().catch(() => shared.solUsd)])
  if (solUsd) addSample(solUsd)
  shared = { tryPerUsd: fx?.tryPerUsd ?? shared.tryPerUsd, fxSource: fx?.source ?? shared.fxSource, solUsd, updatedAt: Date.now() }
  listeners.forEach((listener) => listener(shared))
}

function ensurePolling(intervalMs: number): void {
  if (timer) return
  void tick()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void tick()
  }, intervalMs)
}

export function useLivePrices(intervalMs = 15_000): LivePrices {
  const [prices, setPrices] = useState<LivePrices>(shared)
  useEffect(() => {
    listeners.add(setPrices)
    ensurePolling(intervalMs)
    return () => {
      listeners.delete(setPrices)
    }
  }, [intervalMs])
  return prices
}

export async function getTryPerUsdHistory(): Promise<Point[]> {
  return (await getFxHistory()).points
}

export async function getSolUsdHistory(range: SolRange): Promise<{ points: Point[]; source: string }> {
  const remote = await getSolHistory(range).catch(() => ({ points: [], source: 'none' }))
  if (remote.points.length >= 2) return remote
  const since = Date.now() - RANGE_MS[range]
  const live = await fetchSolUsd().catch(() => null)
  if (live) addSample(live)
  return { points: readSamples().filter((point) => point.t >= since), source: 'samples' }
}
