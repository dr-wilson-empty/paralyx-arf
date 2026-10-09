import { useCallback } from 'react'
import { getActivity, getLine, getWalletState, type ActivityEvent } from './solana'
import type { Shared } from './shared'
import { useWallet } from './wallet'
import { PROGRAM_ID } from '../config'
import { useLivePrices } from './prices'
import { useCached } from './store'

const EMPTY: ActivityEvent[] = []

const kamino = () => import('./kamino')

export function useShared(): Shared & { events: ActivityEvent[]; allEvents: ActivityEvent[]; loading: boolean } {
  const { address, signer } = useWallet()
  const live = useLivePrices()
  const wallet = useCached(address ? `wallet:${address}` : null, () => getWalletState(address ?? ''), { ttl: 15_000, persist: true, refreshMs: 30_000 })
  const line = useCached(address && PROGRAM_ID ? `line:${address}` : null, () => getLine(address ?? ''), { ttl: 30_000, persist: true })
  const position = useCached(address ? `position:${address}` : null, () => kamino().then((module) => module.getPosition(address ?? '')), { ttl: 30_000, persist: true, refreshMs: 30_000 })
  const status = useCached('marketStatus', () => kamino().then((module) => module.getMarketStatus()), { ttl: 60_000, persist: true, refreshMs: 60_000 })
  const events = useCached(PROGRAM_ID ? 'events' : null, getActivity, { ttl: 20_000, persist: true, refreshMs: 30_000 })

  const refresh = useCallback(async () => {
    await Promise.all([wallet.refresh(), line.refresh(), position.refresh(), events.refresh(), status.refresh()])
  }, [wallet, line, position, events, status])

  const allEvents = events.data ?? EMPTY
  return {
    signer,
    wallet: wallet.data ?? null,
    line: line.data ?? null,
    position: position.data ?? null,
    rate: live.tryPerUsd,
    marketStatus: status.data ?? null,
    refresh,
    events: address ? allEvents.filter((event) => event.user === address) : EMPTY,
    allEvents,
    loading: wallet.loading || line.loading || position.loading,
  }
}
