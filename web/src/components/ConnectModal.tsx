import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Wallet, X } from 'lucide-react'
import { NETWORK } from '../config'
import { useT } from '../lib/i18n'
import { useWallet } from '../lib/wallet'

export function ConnectModal() {
  const { t } = useT()
  const { connectOpen, closeConnect, supported, connect, connecting, error } = useWallet()
  const [showOthers, setShowOthers] = useState(false)
  const installed = supported.filter((wallet) => wallet.isAvailable)
  const others = supported.filter((wallet) => !wallet.isAvailable)

  useEffect(() => {
    if (!connectOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeConnect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectOpen, closeConnect])

  return (
    <AnimatePresence>
      {connectOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeConnect}
        >
          <motion.div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-line bg-surface p-6 shadow-xl"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <img src="/brand/paralyx-mark-256.png" alt="" className="mt-0.5 h-8 w-8 dark:invert" draggable={false} />
                <div>
                  <h2 className="text-xl text-ink">{t('connectTitle')}</h2>
                  <p className="mt-1 text-sm text-mute">{t('connectBody')}</p>
                </div>
              </div>
              <button type="button" onClick={closeConnect} className="rounded-full border border-line p-2 text-mute transition hover:border-accent-strong hover:text-ink" aria-label={t('close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {supported.length === 0 ? <li className="rounded-2xl bg-soft p-4 text-sm text-mute">…</li> : null}
              {[...installed, ...(showOthers ? others : [])].map((wallet, index) => (
                <motion.li
                  key={wallet.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={connecting !== null}
                    onClick={() => {
                      if (wallet.isAvailable) void connect(wallet)
                      else window.open(wallet.url, '_blank', 'noreferrer')
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition hover:border-accent-strong hover:bg-accent-soft disabled:opacity-50"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white">
                      {wallet.icon ? <img src={wallet.icon} alt="" className="h-6 w-6 object-contain" /> : <Wallet className="h-4 w-4 text-mute" />}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm text-ink">{wallet.name}</span>
                      <span className="block text-xs text-mute">{connecting === wallet.id ? t('connecting') : wallet.isAvailable ? t('installed') : t('notInstalled')}</span>
                    </span>
                    <span className="pill">{wallet.isAvailable ? t('connect') : t('install')}</span>
                  </motion.button>
                </motion.li>
              ))}
              {others.length > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowOthers((value) => !value)}
                    className="flex w-full items-center justify-between rounded-2xl px-4 py-2.5 text-xs text-mute transition hover:text-ink"
                  >
                    <span>
                      {t('otherWallets')} · {others.length}
                    </span>
                    <ChevronDown className={`h-4 w-4 transition ${showOthers ? 'rotate-180' : ''}`} />
                  </button>
                </li>
              ) : null}
            </ul>
            {error ? <p className="mt-3 break-all text-xs text-ink">{error}</p> : null}
            <p className="mt-4 text-xs text-mute">
              {t('network')}: Solana {NETWORK.label.toLowerCase()}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
