import { useEffect, useId, useMemo, useState } from 'react'
import { NETWORK, PROGRAM_ID, SAFETY_BUFFER, SOL_DECIMALS, SOL_FEE_RESERVE, USDC_DECIMALS } from '../config'
import type { Position } from '../lib/kamino'
import { formatAmount, formatClock, fromUnits, lamports, openLine, repayLine, requestDevnetSol, usdcUnits, WITHDRAW_ALL, type ActivityEvent } from '../lib/solana'
import { useT } from '../lib/i18n'
import { getSolUsdHistory, getTryPerUsdHistory, useLivePrices, type SolRange } from '../lib/prices'
import { useCached } from '../lib/store'
import { txLink, useFlow, type Shared } from '../lib/shared'
import { MarketStatusBadge, borrowAllowed, supplyAllowed } from './MarketStatusBadge'
import { MotionButton } from './MotionButton'
import { PriceChart, type Point } from './PriceChart'
import { Steps } from './Steps'
import { TokenIcon, type TokenSymbol } from './TokenIcon'

function Metric({ label, value, hint, symbol }: { label: string; value: string; hint?: string; symbol?: TokenSymbol }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center gap-2 text-xs text-mute">
        {symbol ? <TokenIcon symbol={symbol} size={16} /> : null}
        {label}
      </div>
      <div className="mt-1 text-lg text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-mute">{hint}</div> : null}
    </div>
  )
}

function previewBorrowable(position: Position, extraSol: number): number {
  const borrowLimitUsd = position.borrowLimitUsd + extraSol * position.solPrice * position.maxLtv
  const headroom = Math.max(0, borrowLimitUsd - position.debtValueUsd)
  return (headroom / Math.max(position.usdcPrice, 1e-9)) * SAFETY_BUFFER
}

function percent(value: number): string {
  return `${formatAmount(value * 100, 1)}%`
}

export function LineCard({ line, position, rate, wallet, marketStatus }: Shared) {
  const { t } = useT()
  const borrowingOpen = borrowAllowed(marketStatus)
  const limitTry = position && rate ? position.borrowableUsdc * rate : null
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-mute">
          <TokenIcon symbol="TRY" size={18} />
          {t('limit')}
        </div>
        <MarketStatusBadge status={marketStatus} />
      </div>
      {borrowingOpen ? (
        <div className="mt-2 text-5xl tracking-tight text-ink">{limitTry === null ? '·' : `₺${formatAmount(limitTry, 0)}`}</div>
      ) : (
        <div className="mt-2 text-3xl tracking-tight text-ink">{t('limitClosed')}</div>
      )}
      <div className="mt-1 text-sm text-mute">
        {borrowingOpen && position ? `${formatAmount(position.borrowableUsdc)} USDC` : ''}
        {rate ? `${borrowingOpen && position ? ' · ' : ''}1 USDC ≈ ₺${formatAmount(rate)}` : ''}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Metric
          symbol="SOL"
          label={t('collateral')}
          value={position ? `${formatAmount(position.collateralSol, 4)} SOL` : '·'}
          hint={position ? `$${formatAmount(position.collateralSol * position.solPrice)}` : undefined}
        />
        <Metric
          symbol="USDC"
          label={t('debt')}
          value={position ? `${formatAmount(position.debtUsdc)} USDC` : '·'}
          hint={position && rate ? `₺${formatAmount(position.debtUsdc * rate)}` : undefined}
        />
        <Metric
          label={t('health')}
          value={position ? (position.healthFactor === null ? t('noDebt') : formatAmount(position.healthFactor)) : '·'}
          hint={position && position.debtUsdc > 0 ? `${t('ltv')} ${percent(position.loanToValue)} · ${t('liquidationLtv')} ${percent(position.liquidationLtv)}` : undefined}
        />
        <Metric
          symbol="SOL"
          label={t('balance')}
          value={wallet ? `${formatAmount(wallet.sol, 4)} SOL` : '·'}
          hint={wallet && wallet.usdc !== null ? `${formatAmount(wallet.usdc)} USDC` : undefined}
        />
      </div>
      {line ? (
        <div className="mt-6 space-y-1 text-sm text-mute">
          <div className="text-xs text-mute">{t('yourLine')}</div>
          <div className="flex justify-between">
            <span>{t('totalBorrowed')}</span>
            <span className="text-ink">{fromUnits(line.borrowed, USDC_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span>{t('totalRepaid')}</span>
            <span className="text-ink">{fromUnits(line.repaid, USDC_DECIMALS)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span>{t('payouts')}</span>
            <span className="text-ink">
              {line.payouts} · ₺{formatAmount(Number(line.payoutTry) / 100)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function WalletCard({ signer, wallet, refresh }: Shared) {
  const { t } = useT()
  const flow = useFlow()
  if (!signer || !wallet || !NETWORK.faucet || wallet.sol >= 0.5) return null
  const fund = () =>
    flow.run(['sending', 'done'], async (mark) => {
      mark(0, 'active')
      const signature = await requestDevnetSol(signer.address)
      mark(0, 'done', txLink(signature))
      mark(1, 'done')
      await refresh()
    })
  return (
    <div className="card">
      <h3 className="text-lg text-ink">{t('walletTitle')}</h3>
      <p className="mt-1 text-sm text-mute">{t('walletBody')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <MotionButton disabled={flow.busy} onClick={() => void fund()}>
          <TokenIcon symbol="SOL" size={18} /> {t('fund')}
        </MotionButton>
      </div>
      <Steps steps={flow.steps} />
      {flow.error ? (
        <p className="mt-3 text-sm text-ink">
          {flow.error}{' '}
          <a className="underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            {t('faucetFallback')}
          </a>
        </p>
      ) : null}
    </div>
  )
}

export function OpenCard({ signer, wallet, position, rate, refresh, marketStatus }: Shared) {
  const { t } = useT()
  const collateralId = useId()
  const borrowId = useId()
  const [collateral, setCollateral] = useState('1')
  const [borrow, setBorrow] = useState('10')
  const flow = useFlow()
  const canBorrow = borrowAllowed(marketStatus)
  const canSupply = supplyAllowed(marketStatus)
  useEffect(() => {
    if (!canBorrow) setBorrow('0')
  }, [canBorrow])
  const collateralNumber = Number(collateral.replace(',', '.')) || 0
  const borrowNumber = Number(borrow.replace(',', '.')) || 0
  const maxBorrow = useMemo(() => (position ? previewBorrowable(position, collateralNumber) : null), [position, collateralNumber])
  const ready = Boolean(signer && wallet && PROGRAM_ID && position)
  const valid =
    ready &&
    canSupply &&
    (canBorrow || borrowNumber === 0) &&
    collateralNumber >= 0 &&
    borrowNumber >= 0 &&
    collateralNumber + borrowNumber > 0 &&
    (maxBorrow === null || borrowNumber <= maxBorrow + 1e-9) &&
    (!wallet || collateralNumber <= wallet.sol - SOL_FEE_RESERVE)
  const submit = () =>
    flow.run(['signing', 'sending', 'done'], async (mark) => {
      if (!signer) throw new Error(t('needWallet'))
      mark(0, 'active')
      const signature = await openLine(signer, lamports(collateral.replace(',', '.') || '0'), usdcUnits(borrow.replace(',', '.') || '0'))
      mark(0, 'done')
      mark(1, 'done', txLink(signature))
      mark(2, 'done')
      await refresh()
    })
  return (
    <div className="card">
      <h3 className="text-lg text-ink">{t('openTitle')}</h3>
      <p className="mt-1 text-sm text-mute">{t('openBody')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={collateralId} className="label flex items-center gap-2">
            <TokenIcon symbol="SOL" size={16} /> {t('collateralSol')}
          </label>
          <input id={collateralId} className="input" inputMode="decimal" value={collateral} onChange={(e) => setCollateral(e.target.value)} />
          {wallet ? (
            <div className="mt-1 text-xs text-mute">
              {t('balance')}: {formatAmount(wallet.sol, 4)} SOL
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor={borrowId} className="label flex items-center gap-2">
            <TokenIcon symbol="USDC" size={16} /> {t('borrowUsdc')}
          </label>
          <input id={borrowId} className="input disabled:bg-soft disabled:text-mute" inputMode="decimal" value={borrow} disabled={!canBorrow} onChange={(e) => setBorrow(e.target.value)} />
          <div className="mt-1 text-xs text-mute">
            {[
              !canBorrow ? t('limitClosed') : maxBorrow !== null ? `${t('maxBorrow')} ${formatAmount(maxBorrow)} USDC` : '',
              canBorrow && rate && borrowNumber > 0 ? `${t('equalsTry')} ₺${formatAmount(borrowNumber * rate)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      {marketStatus !== null && !canBorrow ? (
        <div className="mt-4 rounded-2xl bg-soft p-4 text-xs text-mute">
          <MarketStatusBadge status={marketStatus} />
          <p className="mt-2">{canSupply ? t('borrowClosedHint') : t('supplyClosedHint')}</p>
        </div>
      ) : null}
      <MotionButton className="mt-4" disabled={!valid || flow.busy} onClick={() => void submit()}>
        {canBorrow ? t('open') : t('collateralOnly')}
      </MotionButton>
      {!PROGRAM_ID ? <p className="mt-2 text-xs text-mute">{t('contractPending')}</p> : !ready && signer ? <p className="mt-2 text-xs text-mute">{t('walletBody')}</p> : null}
      <Steps steps={flow.steps} />
      {flow.error ? <p className="mt-3 break-all text-sm text-ink">{flow.error}</p> : null}
    </div>
  )
}

export function WithdrawCard({ signer, position, line, refresh }: Shared) {
  const { t } = useT()
  const amountId = useId()
  const [amount, setAmount] = useState('')
  const [receipt, setReceipt] = useState<{ withdrawn: number; hash: string } | null>(null)
  const flow = useFlow()
  const collateral = position?.collateralSol ?? 0
  const debt = position?.debtUsdc ?? 0
  const numeric = Number(amount.replace(',', '.')) || 0
  if (!signer || !PROGRAM_ID || collateral <= 0) return null
  const all = numeric >= collateral - 1e-9
  const fraction = Math.min(numeric, collateral) / collateral
  const reasons: string[] = []
  if (!line) reasons.push(t('reasonLine'))
  if (numeric <= 0) reasons.push(t('reasonAmount'))
  if (numeric > collateral + 1e-9) reasons.push(t('reasonBalance'))
  if (debt > 0 && position && position.collateralValueUsd * (1 - fraction) * position.maxLtv < position.debtValueUsd * 1.05) reasons.push(t('reasonHealth'))
  const valid = reasons.length === 0 && !flow.busy
  const submit = () =>
    flow.run(['signing', 'sending', 'done'], async (mark) => {
      if (!position) throw new Error(t('needWallet'))
      mark(0, 'active')
      const units = all && debt <= 0 ? WITHDRAW_ALL : BigInt(Math.floor(numeric * 10 ** SOL_DECIMALS * position.ctokensPerSol))
      const signature = await repayLine(signer, 0n, units)
      mark(0, 'done')
      mark(1, 'done', txLink(signature))
      mark(2, 'done')
      setReceipt({ withdrawn: Math.min(numeric, collateral), hash: signature })
      setAmount('')
      await refresh()
    })
  return (
    <div className="card">
      <h3 className="flex items-center gap-2 text-lg text-ink">
        <TokenIcon symbol="SOL" size={22} /> {t('withdrawTitle')}
      </h3>
      <p className="mt-1 text-sm text-mute">{t('withdrawBody')}</p>
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-sm">
        <span className="text-mute">{t('inPool')}</span>
        <span className="text-ink">{formatAmount(collateral, 4)} SOL</span>
      </div>
      <div className="mt-3">
        <label htmlFor={amountId} className="label flex items-center gap-2">
          <TokenIcon symbol="SOL" size={16} /> {t('collateralSol')}
        </label>
        <div className="flex gap-2">
          <input id={amountId} className="input" inputMode="decimal" value={amount} placeholder={formatAmount(collateral, 4)} onChange={(e) => setAmount(e.target.value)} disabled={flow.busy} />
          <button type="button" className="chip shrink-0" onClick={() => setAmount(String(collateral))}>
            {t('withdrawAll')}
          </button>
        </div>
      </div>
      <MotionButton className="mt-4" disabled={!valid} onClick={() => void submit()}>
        {t('withdrawAction')}
      </MotionButton>
      {amount !== '' && reasons.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-mute">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <Steps steps={flow.steps} />
      {receipt ? (
        <div className="mt-4 rounded-2xl border border-accent bg-accent-soft p-4 text-sm">
          <div className="text-ink">{t('receiptWithdraw')}</div>
          <div className="mt-1 flex justify-between text-mute">
            <span>{t('withdrawnSol')}</span>
            <span className="text-ink">{formatAmount(receipt.withdrawn, 4)} SOL</span>
          </div>
          <a className="mt-2 inline-block text-xs underline" href={txLink(receipt.hash)} target="_blank" rel="noreferrer">
            {t('view')}
          </a>
        </div>
      ) : null}
      {flow.error ? <p className="mt-3 break-all text-sm text-ink">{flow.error}</p> : null}
    </div>
  )
}

export function ActivityList({ events, title }: { events: ActivityEvent[]; title: string }) {
  const { t } = useT()
  return (
    <div className="card">
      <h3 className="text-lg text-ink">{title}</h3>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-mute">{t('noActivity')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {events.slice(0, 12).map((event) => (
            <li key={`${event.txHash}-${event.kind}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <TokenIcon symbol={event.kind === 'payout' ? 'TRY' : event.kind === 'opened' ? 'SOL' : 'USDC'} size={20} />
                <span className="text-ink">{t(event.kind)}</span>
                <span className="text-xs text-mute">
                  {event.user.slice(0, 4)}…{event.user.slice(-4)}
                </span>
              </div>
              <div className="text-right text-xs text-mute">
                {event.kind === 'payout'
                  ? `₺${formatAmount(Number(event.a) / 100)}`
                  : event.kind === 'opened'
                    ? `${fromUnits(event.a, SOL_DECIMALS, 4)} SOL · ${fromUnits(event.b, USDC_DECIMALS)} USDC`
                    : `${fromUnits(event.a, USDC_DECIMALS)} USDC · ${fromUnits(event.b, SOL_DECIMALS, 4)} SOL`}
                <a href={txLink(event.txHash)} target="_blank" rel="noreferrer" className="ml-2 underline">
                  {t('view')}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fxLabel(source: string | null): string {
  if (source === 'pyth') return 'Pyth FX'
  if (source === 'reflector') return 'Reflector FX'
  return ''
}

export function Charts() {
  const { t } = useT()
  const live = useLivePrices()
  const [solRange, setSolRange] = useState<SolRange>('24h')
  const tryQuery = useCached<Point[]>('chart:try', getTryPerUsdHistory, { ttl: 120_000, persist: true, refreshMs: 120_000 })
  const solQuery = useCached(`chart:sol:${solRange}`, () => getSolUsdHistory(solRange), { ttl: 60_000, persist: true, refreshMs: 60_000 })
  const stamp = live.updatedAt ? `${t('live')} · ${formatClock(live.updatedAt)}` : t('live')
  const ranges = [
    { id: '24h', label: t('range24h') },
    { id: '7d', label: t('range7d') },
    { id: '30d', label: t('range30d') },
  ]
  const source = fxLabel(live.fxSource)
  return (
    <>
      <PriceChart
        title={t('chartTry')}
        subtitle={source ? `${t('chartTrySub24')} · ${source}` : t('chartTrySub24')}
        points={tryQuery.data ?? []}
        format={(value) => `₺${formatAmount(value)}`}
        icon={<TokenIcon symbol="TRY" size={32} />}
        live={live.tryPerUsd}
        liveLabel={stamp}
        loading={tryQuery.loading}
        precision={2}
        minSpan={0.01}
      />
      <PriceChart
        title={t('chartSol')}
        subtitle={solQuery.data?.source === 'samples' ? t('chartSolSamples') : t('chartSolSub')}
        points={solQuery.data?.points ?? []}
        format={(value) => `$${formatAmount(value, 2)}`}
        icon={<TokenIcon symbol="SOL" size={32} />}
        live={live.solUsd}
        liveLabel={stamp}
        ranges={ranges}
        range={solRange}
        onRange={(id) => setSolRange(id as SolRange)}
        loading={solQuery.loading}
        precision={2}
        dense={solRange === '24h'}
        minSpan={0.5}
        volumeUnit="SOL"
      />
    </>
  )
}
