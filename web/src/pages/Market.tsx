import { useMemo } from 'react'
import { IS_MAINNET, NETWORK, PROGRAM_ID, addressLink } from '../config'
import { useCached } from '../lib/store'
import type { MarketOverview } from '../lib/kamino'
import { MarketStatusBadge, borrowAllowed, marketStatusKey, supplyAllowed } from '../components/MarketStatusBadge'
import { formatAmount, getActivity, getLineCount, type ActivityEvent } from '../lib/solana'
import { useT } from '../lib/i18n'
import { PriceChart, type Point } from '../components/PriceChart'
import { KaminoWordmark, TokenIcon } from '../components/TokenIcon'
import { hourlyBuckets, TrendCard } from '../components/TrendCard'

function cumulative(events: ActivityEvent[], pick: (event: ActivityEvent) => number): Point[] {
  const ordered = [...events].sort((a, b) => a.slot - b.slot)
  let running = 0
  const points = ordered.map((event) => {
    running += pick(event)
    return { t: event.closedAt || event.slot * 400, v: running }
  })
  if (points.length === 1) points.unshift({ t: points[0].t - 3_600_000, v: 0 })
  if (points.length > 0) points.push({ t: Date.now(), v: points[points.length - 1].v })
  return points
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function usd(value: number): string {
  return value >= 1_000_000 ? `$${formatAmount(value / 1_000_000)}M` : `$${formatAmount(value, 0)}`
}

export function Market() {
  const { t } = useT()
  const overviewQuery = useCached<MarketOverview>('overview', () => import('../lib/kamino').then((module) => module.getMarketOverview()), { ttl: 60_000, persist: true, refreshMs: 60_000 })
  const eventsQuery = useCached(PROGRAM_ID ? 'events' : null, getActivity, { ttl: 20_000, persist: true, refreshMs: 30_000 })
  const countQuery = useCached(PROGRAM_ID ? 'lineCount' : null, getLineCount, { ttl: 30_000, persist: true, refreshMs: 30_000 })
  const overview = overviewQuery.data ?? null
  const events = useMemo<ActivityEvent[]>(() => eventsQuery.data ?? [], [eventsQuery.data])
  const error = overview ? null : overviewQuery.error

  const tryPoints = useMemo(() => cumulative(events.filter((event) => event.kind === 'payout'), (event) => Number(event.a) / 100), [events])
  const payoutBuckets = useMemo(
    () => hourlyBuckets(events.filter((event) => event.kind === 'payout').map((event) => ({ closedAt: event.closedAt, value: Number(event.a) / 100 }))),
    [events],
  )
  const payoutTotal = events.filter((event) => event.kind === 'payout').reduce((sum, event) => sum + Number(event.a) / 100, 0)
  const payoutLastHour = payoutBuckets[payoutBuckets.length - 1]?.value ?? 0
  const usdcPoints = useMemo(() => cumulative(events.filter((event) => event.kind === 'opened'), (event) => Number(event.b) / 1_000_000), [events])

  const cards = [
    { label: t('poolSupplied'), value: overview ? usd(overview.totalSuppliedUsd) : '·' },
    { label: t('poolBorrowed'), value: overview ? usd(overview.totalBorrowedUsd) : '·' },
    { label: t('utilization'), value: overview ? pct(overview.utilization) : '·' },
    { label: t('paralyxShare'), value: PROGRAM_ID ? String(countQuery.data ?? '·') : '·' },
  ]

  return (
    <div>
      <section className="pb-6">
        <h1 className="text-3xl tracking-tight text-ink sm:text-4xl">{t('marketTitle')}</h1>
        <p className="mt-2 max-w-2xl text-base text-mute">{IS_MAINNET ? t('marketSubtitleMainnet') : t('marketSubtitle')}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <div className="text-xs text-mute">{card.label}</div>
            <div className="mt-2 text-3xl tracking-tight text-ink">{card.value}</div>
          </div>
        ))}
      </section>
      <section className="card mt-5 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <KaminoWordmark height={16} />
            <h3 className="text-lg text-ink">{NETWORK.marketName.replace('Kamino Lend · ', '')}</h3>
            <MarketStatusBadge status={overview?.status ?? null} />
          </div>
          <a className="text-xs text-mute underline" href={addressLink(NETWORK.market)} target="_blank" rel="noreferrer">
            {NETWORK.market.slice(0, 8)}…{NETWORK.market.slice(-6)}
          </a>
        </div>
        <table className="mt-4 w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-mute">
              <th className="pb-3 font-light">{t('asset')}</th>
              <th className="pb-3 font-light">{t('price')}</th>
              <th className="pb-3 font-light">{t('supplied')}</th>
              <th className="pb-3 font-light">{t('supplyApy')}</th>
              <th className="pb-3 font-light">{t('borrowed')}</th>
              <th className="pb-3 font-light">{t('borrowApy')}</th>
              <th className="pb-3 font-light">{t('utilization')}</th>
              <th className="pb-3 font-light">{t('maxLtv')}</th>
              <th className="pb-3 font-light">{t('liquidationLtv')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(overview?.reserves ?? []).map((row) => (
              <tr key={row.address}>
                <td className="py-3">
                  <a className="inline-flex items-center gap-3" href={addressLink(row.address)} target="_blank" rel="noreferrer">
                    <TokenIcon symbol={row.symbol} size={30} />
                    <span>
                      <span className="block text-ink">{row.symbol}</span>
                      <span className="block text-xs text-mute">
                        {row.address.slice(0, 6)}…{row.address.slice(-4)}
                      </span>
                    </span>
                  </a>
                </td>
                <td className="py-3 text-ink">${formatAmount(row.price, row.price < 1 ? 4 : 2)}</td>
                <td className="py-3">
                  <span className="block text-ink">
                    {formatAmount(row.supplied, row.supplied < 100 ? 2 : 0)} {row.symbol}
                  </span>
                  <span className="block text-xs text-mute">{usd(row.suppliedUsd)}</span>
                </td>
                <td className="py-3 text-ink">{pct(row.supplyApy)}</td>
                <td className="py-3">
                  <span className="block text-ink">
                    {formatAmount(row.borrowed, row.borrowed < 100 ? 2 : 0)} {row.symbol}
                  </span>
                  <span className="block text-xs text-mute">{usd(row.borrowedUsd)}</span>
                </td>
                <td className="py-3 text-ink">{pct(row.borrowApy)}</td>
                <td className="py-3 text-ink">{pct(row.utilization)}</td>
                <td className="py-3 text-ink">{pct(row.loanToValue)}</td>
                <td className="py-3 text-ink">{pct(row.liquidationLtv)}</td>
              </tr>
            ))}
            {!overview && !error ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-mute">
                  ·
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-mute">{t('ratesHint')}</p>
        {overview && !borrowAllowed(overview.status) ? (
          <div className="mt-3 rounded-2xl bg-soft p-4 text-xs text-mute">
            <div className="text-ink">{t(marketStatusKey(overview.status))}</div>
            <p className="mt-1">{supplyAllowed(overview.status) ? t('borrowClosedHint') : t('supplyClosedHint')}</p>
          </div>
        ) : null}
        {error ? <p className="mt-2 text-xs text-ink">{error}</p> : null}
      </section>
      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg text-ink">{t('protocolTitle')}</h3>
          {PROGRAM_ID ? (
            <a className="text-xs text-mute underline" href={addressLink(PROGRAM_ID)} target="_blank" rel="noreferrer">
              {PROGRAM_ID.slice(0, 8)}…{PROGRAM_ID.slice(-6)}
            </a>
          ) : (
            <span className="text-xs text-mute">{t('contractPending')}</span>
          )}
        </div>
        <div className="grid gap-5 lg:grid-cols-3 *:min-w-0">
          <TrendCard
            title={t('trendPayouts')}
            subtitle={t('trendSub')}
            data={payoutBuckets}
            totalLabel={t('totalLabel')}
            totalValue={`₺${formatAmount(payoutTotal)}`}
            newLabel={t('lastHour')}
            newValue={`₺${formatAmount(payoutLastHour)}`}
            format={(value) => `₺${formatAmount(value)}`}
          />
          <PriceChart
            title={t('cumulativeTry')}
            subtitle={t('fromEvents')}
            points={tryPoints}
            format={(value) => `₺${formatAmount(value)}`}
            icon={<TokenIcon symbol="TRY" size={32} />}
            stepped
            dense={false}
            emptyLabel={IS_MAINNET ? t('emptyPayoutsMainnet') : t('emptyPayoutsDevnet')}
          />
          <PriceChart
            title={t('cumulativeUsdc')}
            subtitle={t('fromEvents')}
            points={usdcPoints}
            format={(value) => `${formatAmount(value)} USDC`}
            icon={<TokenIcon symbol="USDC" size={32} />}
            stepped
            dense={false}
            emptyLabel={t('emptyBorrows')}
          />
        </div>
      </section>
    </div>
  )
}
