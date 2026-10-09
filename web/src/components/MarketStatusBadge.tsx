import type { MarketStatus } from '../lib/kamino'
import { useT, type DictKey } from '../lib/i18n'

const keys: Record<MarketStatus, DictKey> = { active: 'marketActive', paused: 'marketPaused', emergency: 'marketEmergency' }

export function marketStatusKey(status: MarketStatus): DictKey {
  return keys[status]
}

export function borrowAllowed(status: MarketStatus | null): boolean {
  return status === null || status === 'active'
}

export function supplyAllowed(status: MarketStatus | null): boolean {
  return status !== 'emergency'
}

export function MarketStatusBadge({ status, className = '' }: { status: MarketStatus | null; className?: string }) {
  const { t } = useT()
  if (status === null) return null
  const tone = status === 'active' ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-ink border-ink'
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${tone} ${className}`}>{t(keys[status])}</span>
}
