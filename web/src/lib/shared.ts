import { useState } from 'react'
import type { MarketStatus, Position } from './kamino'
import type { Line, Signer, WalletState } from './solana'
import { useT, type DictKey } from './i18n'
import type { Step } from '../components/Steps'

export { txLink } from '../config'

export interface Shared {
  signer: Signer | null
  wallet: WalletState | null
  line: Line | null
  position: Position | null
  rate: number | null
  marketStatus: MarketStatus | null
  refresh: () => Promise<void>
}

export type Mark = (index: number, state: Step['state'], detail?: string) => void

export function useFlow() {
  const { t } = useT()
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mark: Mark = (index, state, detail) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, state, detail: detail ?? step.detail } : step)))
  const run = async (labels: DictKey[], fn: (mark: Mark) => Promise<void>) => {
    setError(null)
    setBusy(true)
    setSteps(labels.map((label) => ({ label: t(label), state: 'pending' })))
    try {
      await fn(mark)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSteps((current) => {
        const active = current.findIndex((step) => step.state === 'active')
        return current.map((step, i) => (i === active ? { ...step, state: 'failed' } : step))
      })
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setSteps([])
    setError(null)
  }
  return { steps, busy, error, run, reset }
}
