import { useEffect, useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowUpRight, Check, ChevronDown, Copy, RefreshCw } from 'lucide-react'
import { formatAmount } from '../../lib/solana'
import { useT } from '../../lib/i18n'
import { TokenIcon, type TokenSymbol } from '../TokenIcon'

export function sanitizeAmount(raw: string, decimals = 7): string {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, decimals)}`
}

export function ModeSwitch<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string
  value: T
  options: { id: T; label: string; icon?: ReactNode }[]
  onChange: (id: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex w-full rounded-full border border-line bg-soft p-1">
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={'relative flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm transition disabled:opacity-50 ' + (active ? 'text-on-accent' : 'text-mute hover:text-ink')}
          >
            {active ? <motion.span layoutId={`${name}-pill`} className="absolute inset-0 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} /> : null}
            <span className="relative inline-flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function AmountField({
  symbol,
  label,
  value,
  onChange,
  balance,
  balanceLabel,
  max,
  presets = false,
  hint,
  error,
  disabled,
  autoFocus,
  extra,
}: {
  symbol: TokenSymbol
  label: string
  value: string
  onChange: (value: string) => void
  balance?: number
  balanceLabel?: string
  max?: number
  presets?: boolean
  hint?: ReactNode
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
  extra?: ReactNode
}) {
  const { t } = useT()
  const inputId = useId()
  const unit = symbol === 'TRY' ? 'TRY' : symbol
  const applyFraction = (fraction: number) => {
    if (max === undefined) return
    const amount = Math.floor(max * fraction * 100) / 100
    onChange(sanitizeAmount(String(amount)))
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="flex items-center gap-2 text-xs text-mute">
          <TokenIcon symbol={symbol} size={16} /> {label}
        </label>
        {balance !== undefined ? (
          <span className="text-xs text-mute">
            {balanceLabel ?? t('available')}: {symbol === 'TRY' ? '₺' : ''}
            {formatAmount(balance)} {symbol === 'TRY' ? '' : unit}
          </span>
        ) : null}
      </div>
      <div
        className={
          'flex items-center gap-2 rounded-2xl border bg-surface px-4 py-2.5 transition focus-within:border-accent-strong focus-within:ring-2 focus-within:ring-accent-soft ' +
          (error ? 'border-ink' : 'border-line') +
          (disabled ? ' opacity-60' : '')
        }
      >
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(sanitizeAmount(event.target.value))}
          placeholder="0"
          className="min-w-0 flex-1 bg-transparent text-2xl tracking-tight text-ink outline-none placeholder:text-mute"
        />
        <span className="text-sm text-mute">{unit}</span>
      </div>
      {presets && max !== undefined && !disabled ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0.25, 0.5, 1].map((fraction) => (
            <button key={fraction} type="button" className="chip" onClick={() => applyFraction(fraction)}>
              {fraction === 1 ? t('max') : `${fraction * 100}%`}
            </button>
          ))}
          {extra}
        </div>
      ) : extra ? (
        <div className="mt-2 flex flex-wrap gap-1.5">{extra}</div>
      ) : null}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-ink">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-mute">{hint}</p>
      ) : null}
    </div>
  )
}

export function QuoteBar({
  primary,
  secondary,
  updatedAt,
  loading,
  onRefresh,
  source,
}: {
  primary: ReactNode
  secondary?: ReactNode
  updatedAt?: number | null
  loading?: boolean
  onRefresh?: () => void
  source?: string
}) {
  const { t } = useT()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-soft px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="text-ink">{primary}</div>
        {secondary ? <div className="text-xs text-mute">{secondary}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-mute">
        {source ? <span className="hidden sm:inline">{source}</span> : null}
        {age !== null ? <span>{t('secondsAgo').replace('{s}', String(age))}</span> : null}
        {onRefresh ? (
          <button type="button" onClick={onRefresh} className="rounded-full border border-line bg-surface p-1.5 text-mute transition hover:border-accent-strong hover:text-ink" aria-label={t('refreshQuote')} title={t('refreshQuote')}>
            <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function Details({ title, rows, defaultOpen = false }: { title: string; rows: { label: string; value: ReactNode; icon?: ReactNode }[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-mute transition hover:text-ink">
        <span>{title}</span>
        <ChevronDown className={'h-4 w-4 transition ' + (open ? 'rotate-180' : '')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <dl className="space-y-1.5 px-4 pb-3 text-sm">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <dt className="text-mute">{row.label}</dt>
                  <dd className="inline-flex items-center gap-1.5 text-right text-ink">
                    {row.icon}
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function Blocker({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul className="mt-2 space-y-1 text-xs text-mute">
      {reasons.map((reason) => (
        <li key={reason} className="flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {reason}
        </li>
      ))}
    </ul>
  )
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" onClick={() => void copy()} className="chip" title={t('copy')}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? t('copied') : (label ?? t('copy'))}
    </button>
  )
}

export interface ReceiptRow {
  label: string
  value: ReactNode
  copy?: string
}

export function Receipt({
  title,
  rows,
  links,
  onReset,
  resetLabel,
  note,
}: {
  title: string
  rows: ReceiptRow[]
  links?: { label: string; href: string }[]
  onReset: () => void
  resetLabel: string
  note?: ReactNode
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="mt-4 rounded-2xl border border-accent bg-accent-soft p-4">
      <div className="flex items-center gap-2 text-sm text-ink">
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent"
        >
          <Check className="h-3.5 w-3.5" />
        </motion.span>
        {title}
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-mute">{row.label}</dt>
            <dd className="flex items-center gap-2 text-right text-ink">
              {row.value}
              {row.copy ? <CopyButton text={row.copy} /> : null}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-3 text-xs text-mute">{note}</p> : null}
      {links && links.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink transition hover:border-accent-strong">
              {link.label} <ArrowUpRight className="h-3 w-3" />
            </a>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={onReset} className="mt-3 text-xs text-mute underline hover:text-ink">
        {resetLabel}
      </button>
    </motion.div>
  )
}
