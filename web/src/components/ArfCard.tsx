import { FlaskConical, Landmark } from 'lucide-react'
import { addressLink, txLink } from '../config'
import { useArfFacility } from '../lib/arf'
import { useT, type DictKey } from '../lib/i18n'
import { ARF_TODO, type ArfDraw } from '../lib/rail'
import { formatAmount, formatDateTime } from '../lib/solana'
import { Metric } from './cards'

const statusKeys: Record<ArfDraw['status'], DictKey> = { open: 'arfStatusOpen', repaid: 'arfStatusRepaid', overdue: 'arfStatusOverdue' }
const statusTones: Record<ArfDraw['status'], string> = {
  open: 'border-line bg-soft text-mute',
  repaid: 'border-accent bg-accent-soft text-ink',
  overdue: 'border-ink bg-surface text-ink',
}

function Header() {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-mute">
        <Landmark className="h-4 w-4" />
        {t('arfTitle')}
      </div>
      <span className="pill inline-flex items-center gap-1.5">
        <FlaskConical className="h-3.5 w-3.5" /> {t('arfBadge')}
      </span>
    </div>
  )
}

export function ArfCard() {
  const { t } = useT()
  const arf = useArfFacility()
  const data = arf.data
  if (!data || !data.enabled) {
    return (
      <div className="card">
        <Header />
        <p className="mt-3 text-sm text-mute">{data ? t('arfDisabled') : arf.error ? t('arfUnavailable') : '·'}</p>
      </div>
    )
  }
  const used = data.limit > 0 ? Math.min(1, data.outstanding / data.limit) : 0
  return (
    <div className="card">
      <Header />
      <div className="mt-2 text-5xl tracking-tight text-ink">{formatAmount(data.available)}</div>
      <div className="mt-1 text-sm text-mute">USDC {t('arfAvailableOf').replace('{limit}', formatAmount(data.limit, 0))}</div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-soft" role="meter" aria-label={t('arfUtilization')} aria-valuemin={0} aria-valuemax={data.limit} aria-valuenow={data.outstanding}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${used * 100}%` }} />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Metric symbol="USDC" label={t('arfOutstanding')} value={`${formatAmount(data.outstanding)} USDC`} hint={`${t('arfUtilization')} ${formatAmount(used * 100, 1)}%`} />
        <Metric symbol="USDC" label={t('arfLiquidity')} value={`${formatAmount(data.liquidity)} USDC`} />
        <Metric label={t('arfTerm')} value={t('arfDays').replace('{n}', String(data.termDays))} />
        <Metric label={t('arfFee')} value={`${formatAmount(data.feeBps / 100)}%`} hint={`${data.feeBps} bps`} />
      </div>
      {data.overdue > 0 ? <div className="mt-4 rounded-2xl border border-ink px-4 py-2.5 text-xs text-ink">{t('arfOverdueWarning')}</div> : null}
      <div className="mt-6">
        <div className="text-xs text-mute">{t('arfDraws')}</div>
        {data.draws.length === 0 ? (
          <p className="mt-2 text-sm text-mute">{t('arfNoDraws')}</p>
        ) : (
          <ul className="mt-1 divide-y divide-line text-sm">
            {data.draws.slice(0, 5).map((draw) => (
              <li key={draw.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <a href={txLink(draw.signature)} target="_blank" rel="noreferrer" className="block truncate text-ink underline-offset-2 hover:underline">
                    {draw.id}
                  </a>
                  <div className="text-xs text-mute">
                    {t('arfDue')} {formatDateTime(draw.dueAt * 1000)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-ink">{formatAmount(draw.amount)} USDC</span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${statusTones[draw.status]}`}>{t(statusKeys[draw.status])}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-4 text-xs text-mute">{t('arfExplainer')}</p>
      <a className="mt-2 inline-block text-xs underline" href={addressLink(data.facility)} target="_blank" rel="noreferrer">
        {t('arfFacilityWallet')} · {data.facility.slice(0, 6)}…{data.facility.slice(-4)}
      </a>
    </div>
  )
}

export function ArfPendingCard() {
  const { t, lang } = useT()
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-lg text-ink">
        <Landmark className="h-5 w-5" />
        {t('arfPendingTitle')}
      </div>
      <p className="mt-3 text-sm text-mute">{t('arfPendingBody')}</p>
      <ol className="mt-3 space-y-2 text-sm text-mute">
        {ARF_TODO.map((item, index) => (
          <li key={item.en} className="flex gap-3">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-ink">{index + 1}</span>
            <span>{item[lang]}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
