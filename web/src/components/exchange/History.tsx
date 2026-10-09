import { ArrowUpRight, Banknote, RefreshCw, Trash2 } from 'lucide-react'
import { clearHistory, useHistory, type HistoryKind } from '../../lib/history'
import { useT } from '../../lib/i18n'
import { TokenIcon } from '../TokenIcon'

function relative(at: number, lang: 'tr' | 'en'): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  const rtf = new Intl.RelativeTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { numeric: 'auto' })
  if (seconds < 60) return rtf.format(-seconds, 'second')
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute')
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour')
  return rtf.format(-Math.round(seconds / 86400), 'day')
}

function Icon({ kind }: { kind: HistoryKind }) {
  if (kind === 'cashout') return <TokenIcon symbol="TRY" size={22} />
  if (kind === 'repay') return <Banknote className="h-4 w-4" />
  return <RefreshCw className="h-4 w-4" />
}

export function History({ address }: { address: string | null }) {
  const { t, lang } = useT()
  const items = useHistory(address)
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="text-lg text-ink">{t('historyTitle')}</h3>
        {address && items.length > 0 ? (
          <button type="button" onClick={() => clearHistory(address)} className="chip" title={t('clearHistory')}>
            <Trash2 className="h-3 w-3" /> {t('clearHistory')}
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-mute">{t('historyEmpty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.slice(0, 6).map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink">
                  <Icon kind={item.kind} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-ink">{item.title}</div>
                  <div className="truncate text-xs text-mute">
                    {relative(item.at, lang)}
                    {item.detail ? ` · ${item.detail}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right">
                <span className="text-ink">{item.amount}</span>
                {item.links[0] ? (
                  <a href={item.links[0].href} target="_blank" rel="noreferrer" className="text-mute hover:text-ink" title={item.links[0].label}>
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
