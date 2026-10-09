import { useEffect, useState } from 'react'
import { NETWORK_ID } from '../config'

export type HistoryKind = 'cashout' | 'repay'

export interface HistoryItem {
  id: string
  at: number
  kind: HistoryKind
  title: string
  amount: string
  detail?: string
  links: { label: string; href: string }[]
}

const EVENT = 'paralyx-history'

function key(address: string): string {
  return `paralyx:${NETWORK_ID}:history:${address}`
}

export function readHistory(address: string | null): HistoryItem[] {
  if (!address) return []
  try {
    const raw = localStorage.getItem(key(address))
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch {
    return []
  }
}

export function addHistory(address: string, item: Omit<HistoryItem, 'id' | 'at'>): void {
  const next = [{ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() }, ...readHistory(address)].slice(0, 20)
  try {
    localStorage.setItem(key(address), JSON.stringify(next))
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: address }))
}

export function clearHistory(address: string): void {
  try {
    localStorage.removeItem(key(address))
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: address }))
}

export function useHistory(address: string | null): HistoryItem[] {
  const [items, setItems] = useState<HistoryItem[]>(() => readHistory(address))
  useEffect(() => {
    setItems(readHistory(address))
    const refresh = () => setItems(readHistory(address))
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [address])
  return items
}
