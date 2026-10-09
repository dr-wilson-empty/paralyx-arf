import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { WalletReadyState, type Adapter, type WalletName } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider as AdapterProvider, useWallet as useAdapterWallet } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { UnsafeBurnerWalletAdapter } from '@solana/wallet-adapter-unsafe-burner'
import { BURNER_WALLET, NETWORK } from '../config'
import type { Signer } from './solana'

export interface SupportedWallet {
  id: string
  name: string
  icon: string | null
  url: string
  isAvailable: boolean
}

interface WalletContextValue {
  address: string | null
  walletId: string | null
  walletName: string | null
  signer: Signer | null
  supported: SupportedWallet[]
  connectOpen: boolean
  connecting: string | null
  error: string | null
  openConnect: () => void
  closeConnect: () => void
  connect: (wallet: SupportedWallet) => Promise<void>
  disconnect: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue>({
  address: null,
  walletId: null,
  walletName: null,
  signer: null,
  supported: [],
  connectOpen: false,
  connecting: null,
  error: null,
  openConnect: () => undefined,
  closeConnect: () => undefined,
  connect: async () => undefined,
  disconnect: async () => undefined,
})

const FEATURED = [
  { name: 'Phantom', url: 'https://phantom.com/download' },
  { name: 'Solflare', url: 'https://solflare.com/download' },
  { name: 'Backpack', url: 'https://backpack.app/downloads' },
]

function available(state: WalletReadyState): boolean {
  return state === WalletReadyState.Installed || state === WalletReadyState.Loadable
}

function rank(wallet: SupportedWallet): number {
  const featured = FEATURED.findIndex((entry) => entry.name === wallet.name)
  return (wallet.isAvailable ? 0 : 10) + (featured === -1 ? 5 : featured)
}

function Bridge({ children, error, setError }: { children: ReactNode; error: string | null; setError: (value: string | null) => void }) {
  const adapter = useAdapterWallet()
  const [connectOpen, setConnectOpen] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)

  const supported = useMemo<SupportedWallet[]>(() => {
    const list: SupportedWallet[] = adapter.wallets.map((wallet) => ({
      id: wallet.adapter.name,
      name: wallet.adapter.name,
      icon: wallet.adapter.icon,
      url: wallet.adapter.url,
      isAvailable: available(wallet.readyState),
    }))
    for (const entry of FEATURED) {
      if (!list.some((wallet) => wallet.name === entry.name)) list.push({ id: entry.name, name: entry.name, icon: null, url: entry.url, isAvailable: false })
    }
    return list.sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name))
  }, [adapter.wallets])

  useEffect(() => {
    if (adapter.connected) {
      setConnecting(null)
      setConnectOpen(false)
    }
  }, [adapter.connected])

  useEffect(() => {
    if (error) setConnecting(null)
  }, [error])

  const connect = useCallback(
    async (wallet: SupportedWallet) => {
      setError(null)
      setConnecting(wallet.id)
      adapter.select(wallet.name as WalletName)
    },
    [adapter, setError],
  )

  const disconnect = useCallback(async () => {
    await adapter.disconnect().catch(() => undefined)
  }, [adapter])

  const signer = useMemo<Signer | null>(() => {
    const { publicKey, signTransaction } = adapter
    if (!publicKey || !signTransaction) return null
    return { address: publicKey.toBase58(), publicKey, signTransaction: (transaction) => signTransaction(transaction) }
  }, [adapter])

  const value = useMemo<WalletContextValue>(
    () => ({
      address: adapter.publicKey?.toBase58() ?? null,
      walletId: adapter.wallet?.adapter.name ?? null,
      walletName: adapter.wallet?.adapter.name ?? null,
      signer,
      supported,
      connectOpen,
      connecting,
      error,
      openConnect: () => {
        setError(null)
        setConnectOpen(true)
      },
      closeConnect: () => {
        setConnectOpen(false)
        setConnecting(null)
      },
      connect,
      disconnect,
    }),
    [adapter.publicKey, adapter.wallet, signer, supported, connectOpen, connecting, error, setError, connect, disconnect],
  )
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const adapters = useMemo<Adapter[]>(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), ...(BURNER_WALLET ? [new UnsafeBurnerWalletAdapter()] : [])], [])
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((caught: Error) => setError(caught.message || caught.name), [])
  return (
    <ConnectionProvider endpoint={NETWORK.rpcUrl}>
      <AdapterProvider wallets={adapters} autoConnect localStorageKey="paralyx.wallet" onError={onError}>
        <Bridge error={error} setError={setError}>
          {children}
        </Bridge>
      </AdapterProvider>
    </ConnectionProvider>
  )
}

export function useWallet(): WalletContextValue {
  return useContext(WalletContext)
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
