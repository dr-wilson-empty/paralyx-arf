import { Connection, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from '@solana/web3.js'
import { NETWORK, NETWORK_ID, PROGRAM_ID, SOL_DECIMALS, USDC_DECIMALS } from '../config'
import { formatAmount } from './format'
import {
  FARMS_PROGRAM,
  KLEND_PROGRAM,
  SOL_MINT,
  U64_MAX,
  ataAddress,
  computeBudget,
  configAddress,
  confirmSignature,
  createAtaIdempotent,
  decodeConfig,
  eventsFromTransaction,
  decodeLine,
  decodeMarket,
  decodeReserve,
  lineAddress,
  memo,
  openLineInstructions,
  recordPayout as recordPayoutIx,
  repayLineInstructions,
  setupAddresses,
  transferChecked,
  type Deployment,
  type EventKind,
  type LineAccount,
  type MarketFlags,
} from './paralyx'

export interface Signer {
  address: string
  publicKey: PublicKey
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>
}

export type Line = LineAccount

export interface WalletState {
  exists: boolean
  sol: number
  usdc: number | null
}

export interface ActivityEvent {
  kind: EventKind
  user: string
  slot: number
  closedAt: number
  txHash: string
  a: bigint
  b: bigint
  railTxId?: string
}

export const connection = new Connection(NETWORK.rpcUrl, 'confirmed')

export function toUnits(amount: string | number, decimals: number): bigint {
  const [whole, fraction = ''] = String(amount).trim().replace(',', '.').split('.')
  const digits = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole.replace('-', '') || '0') * 10n ** BigInt(decimals) + BigInt(digits || '0')
}

export function fromUnits(value: bigint | number, decimals: number, places = 2): string {
  return formatAmount(Number(value) / 10 ** decimals, places)
}

export { formatAmount, formatClock } from './format'

export const lamports = (sol: string | number) => toUnits(sol, SOL_DECIMALS)
export const usdcUnits = (usdc: string | number) => toUnits(usdc, USDC_DECIMALS)

let deploymentPromise: Promise<Deployment> | null = null

export function getDeployment(): Promise<Deployment> {
  if (!deploymentPromise) {
    deploymentPromise = connection
      .getMultipleAccountsInfo([new PublicKey(NETWORK.collateralReserve), new PublicKey(NETWORK.debtReserve)])
      .then(([collateral, debt]) => {
        if (!collateral || !debt) throw new Error('Kamino reserves not found on this network')
        return {
          program: PROGRAM_ID,
          klend: KLEND_PROGRAM,
          farms: FARMS_PROGRAM,
          market: NETWORK.market,
          collateral: decodeReserve(NETWORK.collateralReserve, collateral.data),
          debt: decodeReserve(NETWORK.debtReserve, debt.data),
        }
      })
      .catch((error: unknown) => {
        deploymentPromise = null
        throw error
      })
  }
  return deploymentPromise
}

export async function getMarketFlags(): Promise<MarketFlags> {
  const info = await connection.getAccountInfo(new PublicKey(NETWORK.market))
  if (!info) throw new Error('Kamino market not found')
  return decodeMarket(info.data)
}

export async function getLine(user: string): Promise<Line | null> {
  if (!PROGRAM_ID) return null
  const info = await connection.getAccountInfo(lineAddress(PROGRAM_ID, user))
  return info ? decodeLine(info.data) : null
}

export async function getLineCount(): Promise<number> {
  if (!PROGRAM_ID) return 0
  const info = await connection.getAccountInfo(configAddress(PROGRAM_ID))
  return info ? (decodeConfig(info.data)?.lineCount ?? 0) : 0
}

export async function getWalletState(address: string): Promise<WalletState> {
  const owner = new PublicKey(address)
  const [balance, usdc] = await Promise.all([
    connection.getBalance(owner),
    connection.getTokenAccountBalance(ataAddress(owner, NETWORK.usdcMint)).catch(() => null),
  ])
  return { exists: balance > 0, sol: balance / LAMPORTS_PER_SOL, usdc: usdc ? Number(usdc.value.uiAmountString ?? 0) : null }
}

let lookupPromise: Promise<AddressLookupTableAccount[]> | null = null

function lookupTables(): Promise<AddressLookupTableAccount[]> {
  if (!NETWORK.lookupTable) return Promise.resolve([])
  if (!lookupPromise) {
    lookupPromise = connection
      .getAddressLookupTable(new PublicKey(NETWORK.lookupTable))
      .then((result) => (result.value ? [result.value] : []))
      .catch(() => {
        lookupPromise = null
        return []
      })
  }
  return lookupPromise
}

function readableError(error: unknown): Error {
  const logs = (error as { logs?: string[] } | null)?.logs ?? []
  const message = logs.map((line) => /Error Message: (.*)$/.exec(line)?.[1]).find(Boolean)
  if (message) return new Error(message.replace(/\.$/, ''))
  return error instanceof Error ? error : new Error(String(error))
}

export async function send(signer: Signer, instructions: TransactionInstruction[]): Promise<string> {
  const [tables, latest] = await Promise.all([lookupTables(), connection.getLatestBlockhash('confirmed')])
  const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: latest.blockhash, instructions }).compileToV0Message(tables)
  const signed = await signer.signTransaction(new VersionedTransaction(message))
  let signature: string
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 })
  } catch (error) {
    throw readableError(error)
  }
  await confirmSignature(connection, signature, latest.lastValidBlockHeight)
  return signature
}

export async function openLine(signer: Signer, collateralLamports: bigint, borrowUnits: bigint): Promise<string> {
  const d = await getDeployment()
  const [metadata, obligation, collateralFarm, debtFarm] = await connection.getMultipleAccountsInfo(setupAddresses(d, signer.publicKey))
  const existing = { metadata: Boolean(metadata), obligation: Boolean(obligation), collateralFarm: Boolean(collateralFarm), debtFarm: Boolean(debtFarm) }
  return send(signer, openLineInstructions(d, signer.publicKey, collateralLamports, borrowUnits, existing))
}

export async function repayLine(signer: Signer, repayUnits: bigint, withdrawCtokens: bigint): Promise<string> {
  const d = await getDeployment()
  return send(signer, repayLineInstructions(d, signer.publicKey, repayUnits, withdrawCtokens))
}

export const REPAY_ALL = U64_MAX
export const WITHDRAW_ALL = U64_MAX

export async function recordPayout(signer: Signer, railTxId: string, tryKurus: bigint): Promise<string> {
  const d = await getDeployment()
  return send(signer, [recordPayoutIx(d, signer.publicKey, railTxId, tryKurus)])
}

export async function payToRail(signer: Signer, treasury: string, usdc: bigint, memoText: string): Promise<string> {
  const d = await getDeployment()
  const user = signer.publicKey
  const owner = new PublicKey(treasury)
  return send(signer, [
    ...computeBudget(100_000, 50_000),
    createAtaIdempotent(user, owner, d.debt.mint, d.debt.tokenProgram),
    transferChecked(ataAddress(user, d.debt.mint, d.debt.tokenProgram), d.debt.mint, ataAddress(owner, d.debt.mint, d.debt.tokenProgram), user, usdc, d.debt.decimals),
    memo(memoText, user),
  ])
}

export async function requestDevnetSol(address: string): Promise<string> {
  if (!NETWORK.faucet) throw new Error('faucet is devnet only')
  const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  let signature: string
  try {
    signature = await connection.requestAirdrop(new PublicKey(address), LAMPORTS_PER_SOL)
  } catch (error) {
    throw new Error(/429|limit|run dry/i.test(String(error)) ? 'faucet limit reached' : String(error))
  }
  await confirmSignature(connection, signature, lastValidBlockHeight)
  return signature
}

interface EventLog {
  newest: string | null
  events: (Omit<ActivityEvent, 'a' | 'b'> & { a: string; b: string })[]
}

const EVENT_LOG_KEY = `paralyx:${NETWORK_ID}:eventlog:v2:${PROGRAM_ID}`
const MAX_LOGGED_EVENTS = 600

function readEventLog(): { newest: string | null; events: ActivityEvent[] } {
  try {
    const raw = localStorage.getItem(EVENT_LOG_KEY)
    if (!raw) return { newest: null, events: [] }
    const parsed = JSON.parse(raw) as EventLog
    return { newest: parsed.newest, events: parsed.events.map((event) => ({ ...event, a: BigInt(event.a), b: BigInt(event.b) })) }
  } catch {
    return { newest: null, events: [] }
  }
}

function writeEventLog(newest: string | null, events: ActivityEvent[]): void {
  try {
    const stored = events.slice(0, MAX_LOGGED_EVENTS).map((event) => ({ ...event, a: event.a.toString(), b: event.b.toString() }))
    localStorage.setItem(EVENT_LOG_KEY, JSON.stringify({ newest, events: stored }))
  } catch {
    return
  }
}

export async function getActivity(): Promise<ActivityEvent[]> {
  if (!PROGRAM_ID) return []
  const program = new PublicKey(PROGRAM_ID)
  const log = readEventLog()
  const fresh: { signature: string }[] = []
  let before: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const batch = await connection.getSignaturesForAddress(program, { before, until: log.newest ?? undefined, limit: 1000 })
    fresh.push(...batch.filter((entry) => !entry.err))
    if (batch.length < 1000) break
    before = batch[batch.length - 1].signature
  }
  if (fresh.length === 0) return log.events
  const decoded: ActivityEvent[] = []
  let missing = false
  for (let index = 0; index < fresh.length; index += 25) {
    const chunk = fresh.slice(index, index + 25)
    const transactions = await connection.getParsedTransactions(chunk.map((entry) => entry.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    missing ||= transactions.some((transaction) => transaction === null)
    for (const transaction of transactions) {
      for (const { signature, blockTime, ...event } of eventsFromTransaction(transaction, PROGRAM_ID)) decoded.push({ ...event, closedAt: (blockTime ?? 0) * 1000, txHash: signature })
    }
  }
  const seen = new Set(log.events.map((event) => `${event.txHash}:${event.kind}`))
  const merged = [...decoded.filter((event) => !seen.has(`${event.txHash}:${event.kind}`)), ...log.events]
  merged.sort((left, right) => right.slot - left.slot)
  writeEventLog(missing ? log.newest : (fresh[0]?.signature ?? log.newest), merged)
  return merged
}

export { SOL_MINT, U64_MAX }
