import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { formatClock } from '../lib/format'

export interface TrendPoint {
  label: string
  value: number
}

export function TrendCard({
  title,
  subtitle,
  data,
  totalLabel,
  totalValue,
  newLabel,
  newValue,
  format,
  icon = <ArrowUpRight className="h-4 w-4" />,
}: {
  title: string
  subtitle: string
  data: TrendPoint[]
  totalLabel: string
  totalValue: string
  newLabel: string
  newValue: string
  format: (value: number) => string
  icon?: ReactNode
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = useMemo(() => Math.max(1e-9, ...data.map((point) => point.value)), [data])
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-2xl tracking-tight text-ink">{title}</h3>
          <p className="text-2xl tracking-tight text-mute">{subtitle}</p>
        </div>
        <motion.span whileHover={{ rotate: 45 }} className="inline-flex rounded-full border border-line bg-surface p-2 text-ink">
          {icon}
        </motion.span>
      </div>
      <div className="relative mt-12 h-40" onMouseLeave={() => setHovered(null)} role="figure" aria-label={title}>
        <AnimatePresence>
          {hovered !== null ? (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-none absolute -top-9 left-0 w-full"
            >
              <div
                className="inline-block rounded-full bg-accent px-2.5 py-1 text-xs text-on-accent shadow"
                style={{ marginLeft: `${((hovered + 0.5) / data.length) * 100}%`, transform: 'translateX(-50%)' }}
              >
                {format(data[hovered].value)}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex h-full w-full items-end justify-between gap-1">
          {data.map((point, index) => {
            const height = `${Math.max(2, (point.value / max) * 100)}%`
            const isHovered = hovered === index
            const isAdjacent = hovered !== null && Math.abs(hovered - index) === 1
            return (
              <div key={`${point.label}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end">
                <div className="flex h-full w-full items-end" onMouseEnter={() => setHovered(index)} role="img" aria-label={`${point.label}: ${format(point.value)}`}>
                  <motion.div
                    className="w-full rounded-t-md"
                    style={{ height }}
                    animate={{ backgroundColor: isHovered ? 'var(--color-accent-strong)' : isAdjacent ? 'var(--color-accent)' : 'var(--color-line)' }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                  />
                </div>
                <span className="mt-2 text-[10px] text-mute">{point.label}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-8 flex justify-between border-t border-line pt-4">
        <div>
          <p className="text-xs text-mute">{totalLabel}</p>
          <p className="text-3xl tracking-tight text-ink">{totalValue}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-mute">{newLabel}</p>
          <p className="text-3xl tracking-tight text-ink">{newValue}</p>
        </div>
      </div>
    </div>
  )
}

export function hourlyBuckets(events: { closedAt: number; value: number }[], hours = 12): TrendPoint[] {
  const now = Date.now()
  const buckets: TrendPoint[] = []
  for (let i = hours - 1; i >= 0; i -= 1) {
    const end = now - i * 3_600_000
    const start = end - 3_600_000
    const value = events.filter((event) => event.closedAt > start && event.closedAt <= end).reduce((sum, event) => sum + event.value, 0)
    buckets.push({ label: formatClock(end, { hour: '2-digit' }), value })
  }
  return buckets
}
