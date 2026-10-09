import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, BarChart3, LineChart } from 'lucide-react'
import { formatAmount } from '../lib/solana'
import { useT } from '../lib/i18n'
import { PriceArea, type Candle, type HoverInfo } from './charts/PriceArea'

export interface Point {
  t: number
  v: number
}

export interface RangeOption {
  id: string
  label: string
}

export function PriceChart({
  title,
  subtitle,
  points,
  candles,
  format,
  icon,
  footer,
  live,
  liveLabel,
  ranges,
  range,
  onRange,
  allowCandles = false,
  stepped = false,
  loading = false,
  precision = 2,
  height = 220,
  dense = true,
  minSpan = 0,
  emptyLabel,
  volumeUnit = '',
}: {
  title: string
  subtitle: string
  points: Point[]
  candles?: Candle[]
  format: (value: number) => string
  icon?: ReactNode
  footer?: string
  live?: number | null
  liveLabel?: string
  ranges?: RangeOption[]
  range?: string
  onRange?: (id: string) => void
  allowCandles?: boolean
  stepped?: boolean
  loading?: boolean
  precision?: number
  height?: number
  dense?: boolean
  minSpan?: number
  emptyLabel?: string
  volumeUnit?: string
}) {
  const { t, lang } = useT()
  const [mode, setMode] = useState<'area' | 'candles'>('area')
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const series = useMemo(() => (points.length > 0 ? points : (candles ?? []).map((candle) => ({ t: candle.t, v: candle.c }))), [points, candles])
  const stats = useMemo(() => {
    if (series.length === 0) return null
    const values = series.map((point) => point.v)
    const first = values[0]
    const last = values[values.length - 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length
    const change = first > 0 ? ((last - first) / first) * 100 : 0
    const volume = candles ? candles.reduce((sum, candle) => sum + candle.v, 0) : null
    return { first, last, min, max, avg, change, volume }
  }, [series, candles])

  const showLive = live !== undefined && live !== null && !hover
  const headline = hover ? format(hover.value) : showLive ? format(live) : stats ? format(stats.last) : '·'
  const hoverTime = hover ? new Date(hover.time).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
  const up = stats ? stats.change >= 0 : true
  const hasData = series.length > 0
  const changeLabel = stats ? `${stats.change > 0.005 ? '+' : stats.change < -0.005 ? '-' : ''}${formatAmount(Math.abs(stats.change))}%` : ''

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="min-w-0">
            <div className="truncate text-sm text-ink">{title}</div>
            <div className="truncate text-xs text-mute">{subtitle}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-2 text-lg tracking-tight text-ink">
            {showLive ? <span className="live-dot" /> : null}
            {headline}
          </div>
          <div className="flex items-center justify-end gap-2 text-xs text-mute">
            {hover ? (
              <span>{hoverTime}</span>
            ) : (
              <>
                {stats && !stepped ? (
                  <span className={'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ' + (up ? 'bg-accent-soft text-ink' : 'bg-soft text-mute')}>
                    {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {changeLabel}
                  </span>
                ) : null}
                {showLive && liveLabel ? <span>{liveLabel}</span> : null}
              </>
            )}
          </div>
        </div>
      </div>

      {(ranges && ranges.length > 0) || allowCandles ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {(ranges ?? []).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onRange?.(option.id)}
                className={'rounded-full border px-2.5 py-1 text-xs transition ' + (range === option.id ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-mute hover:border-accent-strong hover:text-ink')}
              >
                {option.label}
              </button>
            ))}
          </div>
          {allowCandles && candles && candles.length > 0 ? (
            <div className="flex rounded-full border border-line p-0.5">
              <button type="button" onClick={() => setMode('area')} className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ' + (mode === 'area' ? 'bg-accent text-on-accent' : 'text-mute hover:text-ink')} title={t('chartArea')}>
                <LineChart className="h-3.5 w-3.5" /> {t('chartArea')}
              </button>
              <button type="button" onClick={() => setMode('candles')} className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ' + (mode === 'candles' ? 'bg-accent text-on-accent' : 'text-mute hover:text-ink')} title={t('chartCandles')}>
                <BarChart3 className="h-3.5 w-3.5" /> {t('chartCandles')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative mt-3">
        {hasData ? (
          <PriceArea points={points} candles={candles} mode={allowCandles ? mode : 'area'} stepped={stepped} height={height} format={format} precision={precision} locale={lang === 'tr' ? 'tr-TR' : 'en-US'} dense={dense} minSpan={minSpan} onHover={setHover} />
        ) : (
          <div className="flex items-center justify-center rounded-2xl bg-soft px-6 text-center text-xs text-mute" style={{ height }}>
            {loading ? <span className="live-dot" /> : (emptyLabel ?? t('noData'))}
          </div>
        )}
        {hover?.candle ? (
          <div className="pointer-events-none absolute left-2 top-2 rounded-xl border border-line bg-surface/95 px-3 py-2 text-[11px] text-mute shadow-sm backdrop-blur">
            <div className="flex gap-3">
              <span>
                O <span className="text-ink">{format(hover.candle.o)}</span>
              </span>
              <span>
                H <span className="text-ink">{format(hover.candle.h)}</span>
              </span>
              <span>
                L <span className="text-ink">{format(hover.candle.l)}</span>
              </span>
              <span>
                C <span className="text-ink">{format(hover.candle.c)}</span>
              </span>
            </div>
            <div className="mt-0.5">
              {t('statVolume')} <span className="text-ink">{formatAmount(hover.candle.v, 0)} {volumeUnit}</span>
            </div>
          </div>
        ) : null}
      </div>

      {stats ? (
        <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
          <div>
            <div className="text-mute">{t('statMin')}</div>
            <div className="text-ink">{format(stats.min)}</div>
          </div>
          <div>
            <div className="text-mute">{t('statMax')}</div>
            <div className="text-ink">{format(stats.max)}</div>
          </div>
          <div>
            <div className="text-mute">{t('statAvg')}</div>
            <div className="text-ink">{format(stats.avg)}</div>
          </div>
          <div>
            <div className="text-mute">{stats.volume !== null ? t('statVolume') : stepped ? t('totalLabel') : t('statChange')}</div>
            <div className="text-ink">{stats.volume !== null ? `${formatAmount(stats.volume / 1_000_000, 2)}M ${volumeUnit}` : stepped ? format(stats.last) : changeLabel}</div>
          </div>
        </div>
      ) : null}
      {footer ? <div className="mt-2 text-xs text-mute">{footer}</div> : null}
    </div>
  )
}
