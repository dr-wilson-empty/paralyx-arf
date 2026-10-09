import { useMemo, useState } from 'react'
import { ActivityList } from '../components/cards'
import { MotionButton } from '../components/MotionButton'
import { TokenIcon, type TokenSymbol } from '../components/TokenIcon'
import { PROGRAM_ID, SOL_DECIMALS, USDC_DECIMALS, addressLink } from '../config'
import { useCached } from '../lib/store'
import { formatAmount, fromUnits, getActivity, getLineCount, type ActivityEvent } from '../lib/solana'
import { useT } from '../lib/i18n'
import { useWallet } from '../lib/wallet'

export function Activity() {
  const { t } = useT()
  const { address } = useWallet()
  const [mine, setMine] = useState(false)
  const countQuery = useCached(PROGRAM_ID ? 'lineCount' : null, getLineCount, { ttl: 30_000, persist: true, refreshMs: 30_000 })
  const eventsQuery = useCached(PROGRAM_ID ? 'events' : null, getActivity, { ttl: 20_000, persist: true, refreshMs: 30_000 })
  const count = countQuery.data ?? null
  const events = useMemo<ActivityEvent[]>(() => eventsQuery.data ?? [], [eventsQuery.data])

  const opened = events.filter((event) => event.kind === 'opened')
  const payouts = events.filter((event) => event.kind === 'payout')
  const sol = opened.reduce((sum, event) => sum + event.a, 0n)
  const usdc = opened.reduce((sum, event) => sum + event.b, 0n)
  const tryPaid = payouts.reduce((sum, event) => sum + event.a, 0n)
  const visible = mine && address ? events.filter((event) => event.user === address) : events

  const cards: { label: string; value: string; symbol?: TokenSymbol }[] = [
    { label: t('linesOpened'), value: count === null ? '·' : String(count) },
    { label: t('solLocked'), value: `${fromUnits(sol, SOL_DECIMALS, 2)} SOL`, symbol: 'SOL' },
    { label: t('usdcBorrowed'), value: `${fromUnits(usdc, USDC_DECIMALS)} USDC`, symbol: 'USDC' },
    { label: t('tryPaid'), value: `₺${formatAmount(Number(tryPaid) / 100)}`, symbol: 'TRY' },
  ]

  return (
    <div>
      <section className="pb-6">
        <h1 className="text-3xl tracking-tight text-ink sm:text-4xl">{t('activityTitle')}</h1>
        <p className="mt-2 break-all text-sm text-mute">
          {t('contract')}:{' '}
          {PROGRAM_ID ? (
            <a className="underline" href={addressLink(PROGRAM_ID)} target="_blank" rel="noreferrer">
              {PROGRAM_ID}
            </a>
          ) : (
            t('contractPending')
          )}
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <div className="flex items-center gap-2 text-xs text-mute">
              {card.symbol ? <TokenIcon symbol={card.symbol} size={18} /> : null}
              {card.label}
            </div>
            <div className="mt-2 text-3xl tracking-tight text-ink">{card.value}</div>
          </div>
        ))}
      </section>
      <section className="mt-5">
        <div className="mb-3 flex gap-2">
          <MotionButton variant={mine ? 'ghost' : 'primary'} onClick={() => setMine(false)}>
            {t('everyone')}
          </MotionButton>
          <MotionButton variant={mine ? 'primary' : 'ghost'} disabled={!address} onClick={() => setMine(true)}>
            {t('mine')}
          </MotionButton>
        </div>
        <ActivityList events={visible} title={t('activity')} />
      </section>
    </div>
  )
}
