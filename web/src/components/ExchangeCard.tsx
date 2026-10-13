import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Banknote, FlaskConical } from 'lucide-react'
import { RAIL_MAX_TRY, RAIL_MAX_USDC, RAIL_MIN_TRY, RAIL_MIN_USDC, addressLink } from '../config'
import { rail, type ArfRefusal, type RailFunding, type RailQuote, type RailSettlement } from '../lib/rail'
import { REPAY_ALL, WITHDRAW_ALL, formatAmount, payToRail, recordPayout, repayLine, usdcUnits } from '../lib/solana'
import { refreshArf } from '../lib/arf'
import { addHistory } from '../lib/history'
import { useT, type DictKey } from '../lib/i18n'
import { useLivePrices } from '../lib/prices'
import { txLink, useFlow, type Shared } from '../lib/shared'
import { MotionButton } from './MotionButton'
import { Steps } from './Steps'
import { TokenIcon } from './TokenIcon'
import { AmountField, Blocker, Details, ModeSwitch, QuoteBar, Receipt, type ReceiptRow } from './exchange/primitives'

type Mode = 'cashout' | 'repay'

interface ReceiptData {
  title: string
  rows: ReceiptRow[]
  links: { label: string; href: string }[]
  note?: string
}

const refusalKeys: Record<ArfRefusal, DictKey> = { frozen: 'arfReasonFrozen', limit: 'arfReasonLimit', overdue: 'arfReasonOverdue', liquidity: 'arfReasonLiquidity' }

function fundingLabel(t: (key: DictKey) => string, funding: RailFunding): string {
  if (funding.source === 'arf') return `${t('arfFundedDraw')} ${funding.seq === undefined ? funding.reference : `#${funding.seq}`}`
  return funding.reason ? `${t('arfFundedTreasury')} · ${t(refusalKeys[funding.reason])}` : t('arfFundedTreasury')
}

export function ExchangeCard({ signer, wallet, line, position, rate, refresh }: Shared) {
  const { t } = useT()
  const live = useLivePrices()
  const [mode, setMode] = useState<Mode>('cashout')
  const [amount, setAmount] = useState('10')
  const [quote, setQuote] = useState<{ value: RailQuote; at: number } | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [withdrawAll, setWithdrawAll] = useState(true)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const flow = useFlow()
  const requestId = useRef(0)
  const cashOut = mode === 'cashout'
  const numeric = Number(amount) || 0
  const available = wallet?.usdc ?? 0
  const debt = position?.debtUsdc ?? 0
  const maxCashOut = Math.max(0, Math.min(available, RAIL_MAX_USDC))
  const suggestedRepay = rate && debt > 0 ? Math.min(RAIL_MAX_TRY, Math.ceil(debt * 1.01 * rate)) : 0

  const fetchQuote = useCallback(async (value: number, direction: Mode) => {
    if (value <= 0) {
      setQuote(null)
      return
    }
    requestId.current += 1
    const id = requestId.current
    setQuoting(true)
    try {
      const result = await rail.quote(direction, value)
      if (id === requestId.current) setQuote({ value: result, at: Date.now() })
    } catch {
      if (id === requestId.current) setQuote(null)
    } finally {
      if (id === requestId.current) setQuoting(false)
    }
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => void fetchQuote(numeric, mode), 350)
    return () => clearTimeout(handle)
  }, [numeric, mode, fetchQuote])

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setReceipt(null)
    setQuote(null)
    flow.reset()
    setAmount(next === 'cashout' ? (maxCashOut > 0 ? String(Math.min(10, Math.floor(maxCashOut * 100) / 100)) : '10') : suggestedRepay > 0 ? String(suggestedRepay) : '')
  }

  const amountError = useMemo(() => {
    if (!amount || numeric <= 0) return null
    if (cashOut) {
      if (numeric < RAIL_MIN_USDC || numeric > RAIL_MAX_USDC) return t('amountRange').replace('{min}', `${RAIL_MIN_USDC} USDC`).replace('{max}', `${RAIL_MAX_USDC} USDC`)
      if (wallet && numeric > available) return t('reasonBalance')
      return null
    }
    if (numeric < RAIL_MIN_TRY || numeric > RAIL_MAX_TRY) return t('amountRange').replace('{min}', `₺${RAIL_MIN_TRY}`).replace('{max}', `₺${RAIL_MAX_TRY}`)
    return null
  }, [amount, numeric, cashOut, available, wallet, t])

  const reasons: string[] = []
  if (!signer) reasons.push(t('reasonWallet'))
  else if (!line) reasons.push(t('reasonLine'))
  if (!cashOut && debt <= 0) reasons.push(t('reasonDebt'))
  if (numeric <= 0) reasons.push(t('reasonAmount'))
  if (numeric > 0 && !amountError && !quote) reasons.push(t('reasonQuote'))
  const valid = reasons.length === 0 && !amountError && !flow.busy

  const runCashOut = () =>
    flow.run(['railQuote', 'railPayout', 'paying', 'railWait', 'recording', 'done'], async (mark) => {
      if (!signer) throw new Error(t('needWallet'))
      setReceipt(null)
      mark(0, 'active')
      const fresh = await rail.quote('cashout', numeric)
      mark(0, 'done', `₺${formatAmount(fresh.buyAmount)}`)
      mark(1, 'active')
      const instruction = await rail.startPayout(signer.address, numeric)
      mark(1, 'done', `memo ${instruction.memo}`)
      mark(2, 'active')
      const signature = await payToRail(signer, instruction.treasury, usdcUnits(numeric.toFixed(6)), instruction.memo)
      mark(2, 'done', txLink(signature))
      mark(3, 'active')
      const settled = await rail.confirmPayout(instruction, signature)
      mark(3, 'done', `₺${formatAmount(settled.amountOut)} · ${settled.externalTransactionId ?? ''}`)
      mark(4, 'active')
      const recordHash = await recordPayout(signer, instruction.id, BigInt(Math.round(settled.amountOut * 100)))
      mark(4, 'done', txLink(recordHash))
      mark(5, 'done')
      const links = [
        { label: t('view'), href: txLink(signature) },
        { label: t('railTx'), href: txLink(recordHash) },
      ]
      const rows: ReceiptRow[] = [
        { label: t('sentUsdc'), value: `${formatAmount(numeric)} USDC` },
        { label: t('paidTry'), value: `₺${formatAmount(settled.amountOut)}` },
      ]
      if (settled.externalTransactionId) rows.push({ label: t('sandboxReference'), value: settled.externalTransactionId, copy: settled.externalTransactionId })
      if (settled.arf && 'repaid' in settled.arf && settled.arf.repaid > 0) {
        rows.push({ label: t('arfRepaidOnCashOut'), value: `${formatAmount(settled.arf.repaid)} USDC` })
        if (settled.arf.signature) links.push({ label: t('arfRepayTx'), href: txLink(settled.arf.signature) })
      } else if (settled.arf && 'error' in settled.arf) {
        rows.push({ label: t('arfRepaidOnCashOut'), value: t('arfRepayLater') })
      }
      setReceipt({ title: t('receiptCashOut'), rows, links, note: t('sandboxNote') })
      addHistory(signer.address, { kind: 'cashout', title: t('receiptCashOut'), amount: `₺${formatAmount(settled.amountOut)}`, detail: settled.externalTransactionId, links })
      refreshArf()
      await refresh()
    })

  const runRepay = () =>
    flow.run(['railQuote', 'railDeposit', 'railBank', 'railWait', 'sending', 'done'], async (mark) => {
      if (!signer || !position) throw new Error(t('needWallet'))
      setReceipt(null)
      let settled: RailSettlement | null = null
      if ((wallet?.usdc ?? 0) >= position.debtUsdc * 1.0005) {
        for (const step of [0, 1, 2, 3]) mark(step, 'done', t('walletCovers'))
      } else {
        mark(0, 'active')
        const fresh = await rail.quote('repay', numeric)
        mark(0, 'done', `${formatAmount(fresh.buyAmount, 4)} USDC`)
        mark(1, 'active')
        const deposit = await rail.startDeposit(signer.address, numeric)
        mark(1, 'done', `${t('iban')} ${deposit.iban} · ${deposit.reference}`)
        mark(2, 'active')
        settled = await rail.settleDeposit(deposit)
        mark(2, 'done')
        const settledDetail = settled.signature ? txLink(settled.signature) : `${formatAmount(settled.amountOut)} USDC`
        mark(3, 'done', settled.funding ? `${fundingLabel(t, settled.funding)} · ${settledDetail}` : settledDetail)
      }
      mark(4, 'active')
      const received = settled?.amountOut ?? 0
      const spendable = received + (wallet?.usdc ?? 0)
      const fullRepay = spendable >= position.debtUsdc * 1.0005
      const repayUnits = fullRepay ? REPAY_ALL : usdcUnits((received * 0.999).toFixed(6))
      const withdraw = withdrawAll && fullRepay ? WITHDRAW_ALL : 0n
      const signature = await repayLine(signer, repayUnits, withdraw)
      mark(4, 'done', txLink(signature))
      mark(5, 'done')
      const repaid = fullRepay ? position.debtUsdc : received * 0.999
      const links = [{ label: t('view'), href: txLink(signature) }, ...(settled?.signature ? [{ label: t('railTx'), href: txLink(settled.signature) }] : [])]
      const rows: ReceiptRow[] = [
        ...(settled
          ? [
              { label: t('amountTry'), value: `₺${formatAmount(numeric)}` },
              { label: t('receivedUsdc'), value: `${formatAmount(received)} USDC` },
              ...(settled.funding ? [{ label: t('arfFundedBy'), value: fundingLabel(t, settled.funding) }] : []),
            ]
          : []),
        { label: t('repaidUsdc'), value: `${formatAmount(repaid)} USDC` },
        { label: t('remainingDebt'), value: `${formatAmount(Math.max(0, position.debtUsdc - repaid))} USDC` },
      ]
      if (fullRepay && withdrawAll) rows.push({ label: t('collateralBack'), value: `${formatAmount(position.collateralSol, 4)} SOL` })
      const repayNote = settled ? (settled.funding?.source === 'arf' ? t('sandboxRepayNoteArf') : t('sandboxRepayNote')) : t('walletRepayNote')
      setReceipt({ title: t('receiptRepay'), rows, links, note: repayNote })
      addHistory(signer.address, { kind: 'repay', title: t('receiptRepay'), amount: `${formatAmount(repaid)} USDC`, detail: settled ? `₺${formatAmount(numeric)}` : undefined, links })
      if (settled) refreshArf()
      await refresh()
    })

  const total = quote ? quote.value.buyAmount : rate ? (cashOut ? numeric * rate : numeric / rate) : 0
  const fee = quote ? quote.value.feeTotal : numeric * 0.005
  const rateLine = rate ? (cashOut ? `1 USDC = ₺${formatAmount(rate)}` : `₺1 = ${formatAmount(1 / rate, 4)} USDC`) : '·'
  const sourceLine = live.fxSource ? `${t('quoteHint')} · ${t('fxSource')}: ${live.fxSource === 'pyth' ? 'Pyth' : 'Reflector'}` : t('quoteHint')

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg text-ink">
          <TokenIcon symbol="TRY" size={22} />
          {t('exchange')}
        </h3>
        <span className="pill inline-flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5" /> {t('sandboxBadge')}
        </span>
      </div>
      <div className="mt-4">
        <ModeSwitch
          name="sandbox-exchange"
          value={mode}
          onChange={switchMode}
          disabled={flow.busy}
          options={[
            { id: 'cashout', label: t('modeCashOut'), icon: <ArrowDownToLine className="h-4 w-4" /> },
            { id: 'repay', label: t('modeRepay'), icon: <Banknote className="h-4 w-4" /> },
          ]}
        />
      </div>
      <p className="mt-3 text-sm text-mute">{cashOut ? t('cashOutHint') : t('repayHint')}</p>

      <div className="mt-4 space-y-3">
        {cashOut ? (
          <AmountField symbol="USDC" label={t('amountUsdc')} value={amount} onChange={setAmount} balance={available} max={maxCashOut} presets error={amountError} disabled={flow.busy} autoFocus />
        ) : (
          <AmountField
            symbol="TRY"
            label={t('amountTry')}
            value={amount}
            onChange={setAmount}
            error={amountError}
            disabled={flow.busy}
            hint={debt > 0 ? `${t('debt')}: ${formatAmount(debt)} USDC${rate ? ` ≈ ₺${formatAmount(debt * rate)}` : ''}` : t('noDebtHint')}
            extra={
              suggestedRepay > 0 ? (
                <button type="button" className="chip" onClick={() => setAmount(String(suggestedRepay))}>
                  {t('closeDebt')} · ₺{formatAmount(suggestedRepay, 0)}
                </button>
              ) : null
            }
          />
        )}
        <div className="flex items-center justify-between rounded-2xl border border-line px-4 py-3">
          <span className="text-sm text-mute">{t('youGet')}</span>
          <span className="inline-flex items-center gap-2 text-xl tracking-tight text-ink">
            <TokenIcon symbol={cashOut ? 'TRY' : 'USDC'} size={20} />
            {cashOut ? `₺${formatAmount(total)}` : `${formatAmount(total, 4)} USDC`}
          </span>
        </div>
        <QuoteBar primary={rateLine} secondary={sourceLine} updatedAt={quote?.at ?? null} loading={quoting} onRefresh={() => void fetchQuote(numeric, mode)} source={t('quoteRail')} />
        <Details
          title={t('details')}
          rows={[
            { label: t('feeRailPct'), value: cashOut ? `${formatAmount(fee, 4)} USDC` : `₺${formatAmount(fee)}` },
            { label: t('networkFee'), value: t('networkFeeValue'), icon: <TokenIcon symbol="SOL" size={14} /> },
            { label: t('arrival'), value: t('arrivalSandbox') },
          ]}
        />
        {!cashOut ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-line px-4 py-3 text-sm">
            <input type="checkbox" checked={withdrawAll} onChange={(event) => setWithdrawAll(event.target.checked)} className="accent-accent-strong" />
            {t('withdrawAllShort')}
          </label>
        ) : null}
      </div>

      <MotionButton full className="mt-4 py-3 text-base" disabled={!valid} onClick={() => void (cashOut ? runCashOut() : runRepay())}>
        {cashOut ? t('cashOutAction') : t('repayAction')}
      </MotionButton>
      <Blocker reasons={reasons} />
      <Steps steps={flow.steps} />
      {receipt ? (
        <Receipt
          title={receipt.title}
          rows={receipt.rows}
          links={receipt.links}
          note={receipt.note}
          resetLabel={t('newTransaction')}
          onReset={() => {
            setReceipt(null)
            flow.reset()
          }}
        />
      ) : null}
      {flow.error ? <p className="mt-3 break-all text-sm text-ink">{flow.error}</p> : null}
    </div>
  )
}

export function RailPendingCard() {
  const { t, lang } = useT()
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg text-ink">
          <TokenIcon symbol="TRY" size={22} />
          {t('railPendingTitle')}
        </h3>
        <span className="pill">{rail.label}</span>
      </div>
      <div className="mt-3 rounded-2xl border border-line bg-soft px-4 py-2.5 text-xs text-mute">{t('mainnetWarning')}</div>
      <p className="mt-4 text-sm text-mute">{t('railPendingBody')}</p>
      <ol className="mt-3 space-y-2 text-sm text-mute">
        {rail.todo.map((item, index) => (
          <li key={item.en} className="flex gap-3">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-ink">{index + 1}</span>
            <span>{item[lang]}</span>
          </li>
        ))}
      </ol>
      <a className="mt-4 inline-block text-xs underline" href={addressLink('A94X2fRy3wydNShU4dRaDyap2UuoeWJGWyATtyp61WZf')} target="_blank" rel="noreferrer">
        TRYB · A94X2f…1WZf
      </a>
    </div>
  )
}
