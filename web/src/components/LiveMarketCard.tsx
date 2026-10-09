import { formatAmount } from '../lib/solana'
import type { MarketOverview } from '../lib/kamino'
import { useT } from '../lib/i18n'
import type { LivePrices } from '../lib/prices'
import { KaminoMark, TokenIcon } from './TokenIcon'
import { MarketStatusBadge } from './MarketStatusBadge'

function usd(value: number): string {
  return value >= 1_000_000 ? `$${formatAmount(value / 1_000_000)}M` : `$${formatAmount(value, 0)}`
}

export function LiveMarketCard({ live, overview, lineCount }: { live: LivePrices; overview: MarketOverview | null; lineCount: number | null }) {
  const { t } = useT()
  const rows = [
    { icon: <TokenIcon symbol="TRY" size={26} />, label: t('usdTry'), value: live.tryPerUsd ? `₺${formatAmount(live.tryPerUsd)}` : '·' },
    { icon: <TokenIcon symbol="SOL" size={26} />, label: t('solUsd'), value: live.solUsd ? `$${formatAmount(live.solUsd, 2)}` : '·' },
    {
      icon: (
        <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line bg-surface">
          <KaminoMark size={14} />
        </span>
      ),
      label: t('marketTvl'),
      value: overview ? usd(overview.totalSuppliedUsd) : '·',
    },
  ]
  return (
    <div className="card h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span className="live-dot" />
          {t('liveTitle')}
        </div>
        <span className="text-xs text-mute">{live.updatedAt ? new Date(live.updatedAt).toLocaleTimeString('tr-TR') : ''}</span>
      </div>
      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between rounded-2xl border border-line px-4 py-3">
            <span className="inline-flex items-center gap-3 text-sm text-mute">
              {row.icon}
              {row.label}
            </span>
            <span className="text-xl tracking-tight text-ink">{row.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-2xl bg-soft px-4 py-3">
          <span className="text-sm text-mute">{t('linesTotal')}</span>
          <span className="text-xl tracking-tight text-ink">{lineCount ?? '·'}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-soft px-4 py-3">
          <span className="text-sm text-mute">{t('marketStatusLabel')}</span>
          <MarketStatusBadge status={overview?.status ?? null} />
        </div>
      </div>
      <p className="mt-4 text-xs text-mute">Pyth · Kamino Lend · Solana</p>
    </div>
  )
}
