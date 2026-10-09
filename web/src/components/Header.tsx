import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Copy, LogOut } from 'lucide-react'
import { NETWORK } from '../config'
import { formatAmount, getWalletState, type WalletState } from '../lib/solana'
import { useT } from '../lib/i18n'
import { shortAddress, useWallet } from '../lib/wallet'
import { MotionButton } from './MotionButton'
import { TokenIcon } from './TokenIcon'

export function WalletMenu() {
  const { t } = useT()
  const { address, walletName, disconnect } = useWallet()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<WalletState | null>(null)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !address) return
    getWalletState(address).then(setState).catch(() => setState(null))
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open, address])

  if (!address) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <MotionButton variant="ghost" onClick={() => setOpen((value) => !value)} title={address}>
        <span className="inline-block h-2 w-2 rounded-full bg-accent-strong ring-1 ring-line" />
        {shortAddress(address)}
      </MotionButton>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="absolute right-0 z-40 mt-2 w-72 rounded-3xl border border-line bg-surface p-4 shadow-lg"
          >
            <div className="text-xs text-mute">{walletName ?? t('wallets')} · Solana {NETWORK.label.toLowerCase()}</div>
            <div className="mt-1 break-all text-sm text-ink">{address}</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-mute">
                  <TokenIcon symbol="SOL" size={18} /> SOL
                </span>
                <span className="text-ink">{state ? formatAmount(state.sol, 4) : '·'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-mute">
                  <TokenIcon symbol="USDC" size={18} /> USDC
                </span>
                <span className="text-ink">{state && state.usdc !== null ? formatAmount(state.usdc) : '·'}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <MotionButton variant="ghost" className="flex-1" onClick={() => void copy()}>
                <Copy className="h-4 w-4" /> {copied ? t('copied') : t('copyAddress')}
              </MotionButton>
              <MotionButton variant="ghost" onClick={() => void disconnect()} aria-label={t('disconnect')}>
                <LogOut className="h-4 w-4" />
              </MotionButton>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

