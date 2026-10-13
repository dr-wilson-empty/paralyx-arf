import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Connection, Keypair, PublicKey, Transaction, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction, type SignatureStatus, type TransactionInstruction } from '@solana/web3.js'
import { Account, Contract, Keypair as StellarKeypair, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { createMemoInstruction } from '@solana/spl-memo'

const PYTH_HERMES = 'https://pyth.dourolabs.app/hermes'
const PYTH_USD_TRY = '032a2eba1c2635bf973e95fb62b2c0705c1be2603b9572cc8d5edeaf8744e058'
const PYTH_SOL_USD = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
const REFLECTOR_FX = 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC'
const REFLECTOR_RPC = ['https://soroban-rpc.creit.tech', 'https://mainnet.sorobanrpc.com']
const REFLECTOR_PASSPHRASE = 'Public Global Stellar Network ; September 2015'
const FEE_RATE = 0.005
const USDC_DECIMALS = 6
const LIMITS = { minUsdc: 0.5, maxUsdc: 300, minTry: 50, maxTry: 3000 }
const TOKEN_TTL_SECONDS = 900
const KLEND = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD')
const OBLIGATION_BORROWS = 1208
const OBLIGATION_BORROW_STRIDE = 200
const OBLIGATION_BORROW_SLOTS = 5
const BORROWED_AMOUNT_SF = 88
const DEPOSIT_MARGIN_UNITS = 1_500_000n
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const ARF_DEFAULTS = { limitUsdc: 500, termDays: 3, feeBps: 10 }
const ARF_HISTORY_LIMIT = 1000
const ARF_MAX_REPAY_PARTS = 8
const ARF_DRAW_MEMO = /^ARF-DRAW (ARF-DR-[0-9A-F]{10}) amount=(\d+) fee=(\d+) due=(\d+) ref=(SBX-DP-[0-9A-F]{10})$/
const ARF_REPAY_MEMO = /^ARF-REPAY ((?:ARF-DR-[0-9A-F]{10}:\d+)(?:,ARF-DR-[0-9A-F]{10}:\d+)*)$/

type Json = Record<string, unknown>

export interface ArfTerms {
  limit: bigint
  termSeconds: number
  feeBps: number
}

interface Env {
  treasury: Keypair | null
  arf: Keypair | null
  arfTerms: ArfTerms | string
  connection: Connection
  usdcMint: string
  market: PublicKey
  debtReserve: PublicKey
  pythKey: string | null
  signingKey: Buffer
}

function keypair(secret: string): Keypair | null {
  return secret ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[])) : null
}

export function arfTerms(source: Record<string, string | undefined>): ArfTerms | string {
  const limitUsdc = Number(source.ARF_LIMIT_USDC ?? ARF_DEFAULTS.limitUsdc)
  const termDays = Number(source.ARF_TERM_DAYS ?? ARF_DEFAULTS.termDays)
  const feeBps = Number(source.ARF_FEE_BPS ?? ARF_DEFAULTS.feeBps)
  if (!(limitUsdc > 0 && limitUsdc <= 1_000_000)) return 'ARF_LIMIT_USDC must be above 0 and at most 1000000'
  if (!(Number.isInteger(termDays) && termDays >= 1 && termDays <= 5)) return 'ARF_TERM_DAYS must be a whole number from 1 to 5'
  if (!(Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 500)) return 'ARF_FEE_BPS must be a whole number from 0 to 500'
  return { limit: units(limitUsdc), termSeconds: termDays * 86_400, feeBps }
}

function env(): Env {
  const secret = process.env.SANDBOX_TREASURY_SECRET ?? ''
  return {
    treasury: keypair(secret),
    arf: keypair(process.env.ARF_SANDBOX_SECRET ?? ''),
    arfTerms: arfTerms(process.env),
    connection: new Connection(process.env.RAIL_RPC ?? 'https://api.devnet.solana.com', 'confirmed'),
    usdcMint: process.env.RAIL_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    market: new PublicKey(process.env.RAIL_MARKET ?? '4GiGCkrwHphwrsG8imKSHhjTtmbjorqYrYwMsRtBu77Z'),
    debtReserve: new PublicKey(process.env.RAIL_DEBT_RESERVE ?? 'DJ8gPwXaEX2T8ZJGwZNJc9vL6iwrUUyUrwzeSgjD8RHH'),
    pythKey: process.env.PYTH_API_KEY || null,
    signingKey: createHash('sha256').update(`paralyx-sandbox-rail:${secret}`).digest(),
  }
}

class RailError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

const memoryCache = new Map<string, { at: number; value: unknown }>()
const unentitled = new Set<string>()

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = memoryCache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  const value = await loader()
  memoryCache.set(key, { at: Date.now(), value })
  return value
}

interface PythPrice {
  price: number
  publishTime: number
}

async function pyth(e: Env, id: string, at?: number): Promise<PythPrice | null> {
  if (!e.pythKey || unentitled.has(id)) return null
  const route = at ? `/v2/updates/price/${at}` : '/v2/updates/price/latest'
  const response = await fetch(`${PYTH_HERMES}${route}?ids[]=${id}&parsed=true`, { headers: { authorization: `Bearer ${e.pythKey}` } })
  if (response.status === 403) {
    unentitled.add(id)
    return null
  }
  if (!response.ok) throw new RailError(`pyth ${response.status}`, 502)
  const body = (await response.json()) as { parsed?: { price: { price: string; expo: number; publish_time: number } }[] }
  const entry = body.parsed?.[0]?.price
  if (!entry) return null
  return { price: Number(entry.price) * 10 ** entry.expo, publishTime: entry.publish_time }
}

const reflectorSource = new Account(StellarKeypair.random().publicKey(), '0')

async function reflector(method: 'lastprice' | 'price', timestamp?: number): Promise<{ price: number; timestamp: number } | null> {
  const asset = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Other'), xdr.ScVal.scvSymbol('TRY')])
  const args = method === 'price' && timestamp ? [asset, xdr.ScVal.scvU64(BigInt(timestamp))] : [asset]
  let lastError: unknown = null
  for (const url of REFLECTOR_RPC) {
    try {
      const tx = new TransactionBuilder(reflectorSource, { fee: '100', networkPassphrase: REFLECTOR_PASSPHRASE })
        .addOperation(new Contract(REFLECTOR_FX).call(method, ...args))
        .setTimeout(30)
        .build()
      const sim = await new rpc.Server(url).simulateTransaction(tx)
      if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('reflector simulation failed')
      const record = scValToNative(sim.result.retval) as { price: bigint; timestamp: bigint } | null
      if (!record) return null
      return { price: Number(record.price) / 1e14, timestamp: Number(record.timestamp) }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('reflector unavailable')
}

async function tryPerUsd(e: Env): Promise<{ tryPerUsd: number; source: string; publishTime: number }> {
  return cached('fx', 30_000, async () => {
    const fromPyth = await pyth(e, PYTH_USD_TRY).catch(() => null)
    if (fromPyth && fromPyth.price > 0) return { tryPerUsd: fromPyth.price, source: 'pyth', publishTime: fromPyth.publishTime }
    const fromReflector = await reflector('lastprice')
    if (!fromReflector || fromReflector.price <= 0) throw new RailError('no USD/TRY price available', 502)
    return { tryPerUsd: 1 / fromReflector.price, source: 'reflector', publishTime: fromReflector.timestamp }
  })
}

async function fxHistory(e: Env): Promise<{ points: { t: number; v: number }[]; source: string }> {
  return cached('fx-history', 600_000, async () => {
    const now = Math.floor(Date.now() / 1000 / 3600) * 3600
    const stamps = Array.from({ length: 25 }, (_, index) => now - (24 - index) * 3600)
    if (e.pythKey && (await pyth(e, PYTH_USD_TRY).catch(() => null))) {
      const points = await Promise.all(stamps.map((stamp) => pyth(e, PYTH_USD_TRY, stamp).catch(() => null)))
      const valid = points.filter((point): point is PythPrice => Boolean(point && point.price > 0)).map((point) => ({ t: point.publishTime * 1000, v: point.price }))
      if (valid.length >= 6) return { points: valid, source: 'pyth' }
    }
    const points = await Promise.all(stamps.map((stamp) => reflector('price', stamp).catch(() => null)))
    return {
      points: points.filter((point): point is { price: number; timestamp: number } => Boolean(point && point.price > 0)).map((point) => ({ t: point.timestamp * 1000, v: 1 / point.price })),
      source: 'reflector',
    }
  })
}

const SOL_RANGES: Record<string, { step: number; count: number }> = {
  '24h': { step: 3600, count: 24 },
  '7d': { step: 6 * 3600, count: 28 },
  '30d': { step: 86_400, count: 30 },
}

async function solHistory(e: Env, range: string): Promise<{ points: { t: number; v: number }[]; source: string }> {
  const spec = SOL_RANGES[range] ?? SOL_RANGES['24h']
  if (!e.pythKey) return { points: [], source: 'none' }
  return cached(`sol:${range}`, 300_000, async () => {
    const now = Math.floor(Date.now() / 1000 / spec.step) * spec.step
    const stamps = Array.from({ length: spec.count + 1 }, (_, index) => now - (spec.count - index) * spec.step)
    const points = await Promise.all(stamps.map((stamp) => pyth(e, PYTH_SOL_USD, stamp).catch(() => null)))
    return { points: points.filter((point): point is PythPrice => Boolean(point && point.price > 0)).map((point) => ({ t: point.publishTime * 1000, v: point.price })), source: 'pyth' }
  })
}

function quote(rate: number, side: string, amount: number) {
  if (!(amount > 0)) throw new RailError('amount must be positive')
  const fee = amount * FEE_RATE
  if (side === 'cashout') {
    const buyAmount = (amount - fee) * rate
    return { price: buyAmount / amount, sellAmount: amount, buyAmount, feeTotal: fee, rate }
  }
  const buyAmount = (amount - fee) / rate
  return { price: buyAmount / amount, sellAmount: amount, buyAmount, feeTotal: fee, rate }
}

function sign(e: Env, payload: Json): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', e.signingKey).update(body).digest('base64url')
  return `${body}.${mac}`
}

function verify(e: Env, token: string, kind: string): Json {
  const [body, mac] = token.split('.')
  if (!body || !mac) throw new RailError('malformed token')
  const expected = createHmac('sha256', e.signingKey).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new RailError('invalid token', 401)
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Json
  if (payload.kind !== kind) throw new RailError('wrong token kind')
  if (Number(payload.exp) < Date.now() / 1000) throw new RailError('instruction expired, start again')
  return payload
}

function requireTreasury(e: Env): Keypair {
  if (!e.treasury) throw new RailError('sandbox treasury is not configured', 503)
  return e.treasury
}

function reference(seed: string): string {
  return `SBX-${createHash('sha256').update(seed).digest('hex').slice(0, 10).toUpperCase()}`
}

function units(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS))
}

async function startPayout(e: Env, body: Json) {
  const treasury = requireTreasury(e)
  const usdc = Number(body.usdc)
  const account = new PublicKey(String(body.account)).toBase58()
  if (!(usdc >= LIMITS.minUsdc && usdc <= LIMITS.maxUsdc)) throw new RailError(`amount must be between ${LIMITS.minUsdc} and ${LIMITS.maxUsdc} USDC`)
  const fx = await tryPerUsd(e)
  const q = quote(fx.tryPerUsd, 'cashout', usdc)
  const id = `SBX-PO-${randomBytes(5).toString('hex').toUpperCase()}`
  const payload = { kind: 'payout', id, account, usdc: units(usdc).toString(), tryAmount: q.buyAmount.toFixed(2), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }
  return { id, treasury: treasury.publicKey.toBase58(), memo: id, usdc, tryAmount: q.buyAmount, quote: q, token: sign(e, payload) }
}

function instructionsOf(tx: Awaited<ReturnType<Connection['getParsedTransaction']>>): (ParsedInstruction | PartiallyDecodedInstruction)[] {
  if (!tx) return []
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions)
  return [...tx.transaction.message.instructions, ...inner]
}

async function confirmPayout(e: Env, body: Json) {
  const treasury = requireTreasury(e)
  const payload = verify(e, String(body.token), 'payout')
  const signature = String(body.signature)
  let tx = null
  for (let attempt = 0; attempt < 10 && !tx; attempt += 1) {
    tx = await e.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    if (!tx) await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  if (!tx || tx.meta?.err) throw new RailError('payment transaction not found or failed')
  const treasuryAta = getAssociatedTokenAddressSync(new PublicKey(e.usdcMint), treasury.publicKey).toBase58()
  const instructions = instructionsOf(tx)
  const paid = instructions.some((ix) => {
    if (!('parsed' in ix) || ix.program !== 'spl-token') return false
    const info = ix.parsed?.info ?? {}
    const amount = info.tokenAmount?.amount ?? info.amount
    return (ix.parsed.type === 'transferChecked' || ix.parsed.type === 'transfer') && info.destination === treasuryAta && info.authority === payload.account && String(amount) === payload.usdc
  })
  const memoMatches = instructions.some((ix) => 'parsed' in ix && (ix.program === 'spl-memo' || ix.programId.toBase58() === MEMO_PROGRAM) && String(ix.parsed) === payload.id)
  if (!paid) throw new RailError('the transaction does not pay the quoted USDC to the sandbox treasury')
  if (!memoMatches) throw new RailError('the transaction memo does not match the payout id')
  const settlement = {
    id: payload.id,
    status: 'completed',
    sandbox: true,
    amountIn: Number(payload.usdc) / 10 ** USDC_DECIMALS,
    amountOut: Number(payload.tryAmount),
    externalTransactionId: reference(`${payload.id}:${signature}`),
    signature,
  }
  if (!e.arf) return settlement
  try {
    return { ...settlement, arf: await arfSweep(e) }
  } catch (error) {
    return { ...settlement, arf: { error: error instanceof Error ? error.message : String(error) } }
  }
}

async function kaminoDebt(e: Pick<Env, 'connection' | 'usdcMint' | 'market' | 'debtReserve'>, owner: PublicKey): Promise<{ debt: bigint; wallet: bigint }> {
  const blank = PublicKey.default.toBuffer()
  const [obligation] = PublicKey.findProgramAddressSync([Buffer.from([0]), Buffer.from([0]), owner.toBuffer(), e.market.toBuffer(), blank, blank], KLEND)
  const [account, balance] = await Promise.all([
    e.connection.getAccountInfo(obligation),
    e.connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(e.usdcMint), owner)).catch(() => null),
  ])
  let debt = 0n
  if (account?.owner.equals(KLEND)) {
    for (let slot = 0; slot < OBLIGATION_BORROW_SLOTS; slot++) {
      const at = OBLIGATION_BORROWS + slot * OBLIGATION_BORROW_STRIDE
      if (!new PublicKey(account.data.subarray(at, at + 32)).equals(e.debtReserve)) continue
      const scaled = account.data.readBigUInt64LE(at + BORROWED_AMOUNT_SF) | (account.data.readBigUInt64LE(at + BORROWED_AMOUNT_SF + 8) << 64n)
      debt += scaled >> 60n
    }
  }
  return { debt, wallet: BigInt(balance?.value.amount ?? '0') }
}

export async function requireRepayment(e: Pick<Env, 'connection' | 'usdcMint' | 'market' | 'debtReserve'>, owner: PublicKey, usdcUnits: bigint): Promise<void> {
  const { debt, wallet } = await kaminoDebt(e, owner)
  if (debt === 0n) throw new RailError('this wallet has no USDC debt on Kamino; the sandbox only settles repayments', 409)
  if (wallet >= debt) throw new RailError('this wallet already holds enough USDC to repay the debt', 409)
  if (usdcUnits > (debt * 102n) / 100n + DEPOSIT_MARGIN_UNITS) throw new RailError('the deposit is larger than the open Kamino debt', 409)
}

async function startDeposit(e: Env, body: Json) {
  requireTreasury(e)
  const tryAmount = Number(body.tryAmount)
  const account = new PublicKey(String(body.account)).toBase58()
  if (!(tryAmount >= LIMITS.minTry && tryAmount <= LIMITS.maxTry)) throw new RailError(`amount must be between ${LIMITS.minTry} and ${LIMITS.maxTry} TRY`)
  const fx = await tryPerUsd(e)
  const q = quote(fx.tryPerUsd, 'repay', tryAmount)
  await requireRepayment(e, new PublicKey(account), units(q.buyAmount))
  const id = `SBX-DP-${randomBytes(5).toString('hex').toUpperCase()}`
  const payload = { kind: 'deposit', id, account, tryAmount: tryAmount.toFixed(2), usdc: units(q.buyAmount).toString(), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }
  return {
    id,
    iban: 'TR00 0000 0000 0000 0000 0000 00 (sandbox)',
    reference: id,
    usdc: q.buyAmount,
    quote: q,
    token: sign(e, payload),
  }
}

async function confirmSignature(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<void> {
  let landed = false
  for (let attempt = 0; attempt < 90; attempt++) {
    let status = await signatureStatus(connection, signature, false)
    if (status === null && !landed && (await connection.getBlockHeight('confirmed').catch(() => 0)) > lastValidBlockHeight) {
      status = await signatureStatus(connection, signature, true)
      if (status === null) throw new RailError(`settlement expired before it landed: ${signature}`, 502)
    }
    if (status?.err) throw new RailError(`settlement failed on chain: ${signature}`, 502)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    landed ||= Boolean(status)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new RailError(`settlement not confirmed in time, check ${signature} before retrying`, 504)
}

function signatureStatus(connection: Connection, signature: string, searchTransactionHistory: boolean): Promise<SignatureStatus | null | undefined> {
  return connection.getSignatureStatuses([signature], { searchTransactionHistory }).then(
    (result) => result.value[0],
    () => undefined,
  )
}

async function submit(e: Env, payer: Keypair, instructions: TransactionInstruction[], cosigners: Keypair[] = []): Promise<string> {
  const tx = new Transaction().add(...instructions)
  const latest = await e.connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer, ...cosigners)
  const signature = await e.connection.sendRawTransaction(tx.serialize(), { maxRetries: 5 })
  await confirmSignature(e.connection, signature, latest.lastValidBlockHeight)
  return signature
}

async function tokenUnits(e: Env, account: PublicKey): Promise<bigint> {
  const balance = await e.connection.getTokenAccountBalance(account).catch(() => null)
  return BigInt(balance?.value.amount ?? '0')
}

function toUsdc(amount: bigint): number {
  return Number(amount) / 10 ** USDC_DECIMALS
}

export interface ArfKeys {
  facility: string
  facilityAta: string
  treasury: string
  treasuryAta: string
  mint: string
}

export type ArfEntry =
  | { kind: 'draw'; id: string; ref: string; amount: bigint; fee: bigint; drawnAt: number; dueAt: number; signature: string }
  | { kind: 'repay'; parts: { id: string; amount: bigint }[]; signature: string }

export interface ArfDraw {
  id: string
  ref: string
  amount: bigint
  fee: bigint
  repaid: bigint
  drawnAt: number
  dueAt: number
  signature: string
  repayments: string[]
}

export interface ArfLedger {
  draws: ArfDraw[]
  outstanding: bigint
  drawn: bigint
  fees: bigint
  repaid: bigint
  overdue: number
  unmatched: bigint
}

export type ArfRefusal = 'overdue' | 'limit' | 'liquidity'

const ARF_REFUSALS: Record<ArfRefusal, string> = {
  overdue: 'a draw is past its due date',
  limit: 'the facility limit is reached',
  liquidity: 'the facility holds too little devnet USDC',
}

export function arfDrawId(depositId: string): string {
  return depositId.replace(/^SBX-DP-/, 'ARF-DR-')
}

export function drawMemo(draw: { id: string; amount: bigint; fee: bigint; dueAt: number; ref: string }): string {
  return `ARF-DRAW ${draw.id} amount=${draw.amount} fee=${draw.fee} due=${draw.dueAt} ref=${draw.ref}`
}

export function repayMemo(parts: { id: string; amount: bigint }[]): string {
  return `ARF-REPAY ${parts.map((part) => `${part.id}:${part.amount}`).join(',')}`
}

export function fundingOf(memo: string): Json {
  const draw = /ARF-DRAW (ARF-DR-[0-9A-F]{10}) amount=\d+ fee=(\d+) due=(\d+)/.exec(memo)
  return draw ? { source: 'arf', drawId: draw[1], fee: toUsdc(BigInt(draw[2])), dueAt: Number(draw[3]) } : { source: 'treasury' }
}

function transfersOf(tx: ParsedTransactionWithMeta): { source: string; destination: string; authority: string; mint: string; amount: bigint }[] {
  return tx.transaction.message.instructions.flatMap((ix) => {
    if (!('parsed' in ix) || ix.program !== 'spl-token' || ix.parsed?.type !== 'transferChecked') return []
    const info = ix.parsed.info ?? {}
    return [{ source: String(info.source), destination: String(info.destination), authority: String(info.authority), mint: String(info.mint), amount: BigInt(String(info.tokenAmount?.amount ?? '0')) }]
  })
}

function memosOf(tx: ParsedTransactionWithMeta): string[] {
  return tx.transaction.message.instructions.flatMap((ix) => ('parsed' in ix && (ix.program === 'spl-memo' || ix.programId.toBase58() === MEMO_PROGRAM) && typeof ix.parsed === 'string' ? [ix.parsed] : []))
}

function signedBy(tx: ParsedTransactionWithMeta, key: string): boolean {
  return tx.transaction.message.accountKeys.some((account) => account.signer && account.pubkey.toBase58() === key)
}

export function readArfEntry(tx: ParsedTransactionWithMeta, signature: string, keys: ArfKeys): ArfEntry | null {
  if (tx.meta?.err) return null
  const transfers = transfersOf(tx)
  const moved = (source: string, destination: string, authority: string, amount: bigint) =>
    transfers.some((transfer) => transfer.source === source && transfer.destination === destination && transfer.authority === authority && transfer.mint === keys.mint && transfer.amount === amount)
  for (const memo of memosOf(tx)) {
    const draw = ARF_DRAW_MEMO.exec(memo)
    if (draw) {
      const amount = BigInt(draw[2])
      if (!signedBy(tx, keys.facility) || !moved(keys.facilityAta, keys.treasuryAta, keys.facility, amount)) return null
      return { kind: 'draw', id: draw[1], ref: draw[5], amount, fee: BigInt(draw[3]), drawnAt: tx.blockTime ?? 0, dueAt: Number(draw[4]), signature }
    }
    const repay = ARF_REPAY_MEMO.exec(memo)
    if (repay) {
      const parts = repay[1].split(',').map((part) => {
        const [id, amount] = part.split(':')
        return { id, amount: BigInt(amount) }
      })
      const total = parts.reduce((sum, part) => sum + part.amount, 0n)
      if (!signedBy(tx, keys.treasury) || !moved(keys.treasuryAta, keys.facilityAta, keys.treasury, total)) return null
      return { kind: 'repay', parts, signature }
    }
  }
  return null
}

export function owed(draw: ArfDraw): bigint {
  const total = draw.amount + draw.fee
  return draw.repaid >= total ? 0n : total - draw.repaid
}

export function arfStatus(draw: ArfDraw, now: number): 'repaid' | 'overdue' | 'open' {
  if (owed(draw) === 0n) return 'repaid'
  return draw.dueAt < now ? 'overdue' : 'open'
}

export function arfLedger(entries: ArfEntry[], now: number): ArfLedger {
  const draws = new Map<string, ArfDraw>()
  for (const entry of entries) {
    if (entry.kind !== 'draw') continue
    const known = draws.get(entry.id)
    if (known) {
      known.amount += entry.amount
      known.fee += entry.fee
      known.drawnAt = Math.min(known.drawnAt, entry.drawnAt)
      known.dueAt = Math.min(known.dueAt, entry.dueAt)
      continue
    }
    draws.set(entry.id, { id: entry.id, ref: entry.ref, amount: entry.amount, fee: entry.fee, repaid: 0n, drawnAt: entry.drawnAt, dueAt: entry.dueAt, signature: entry.signature, repayments: [] })
  }
  let unmatched = 0n
  for (const entry of entries) {
    if (entry.kind !== 'repay') continue
    for (const part of entry.parts) {
      const draw = draws.get(part.id)
      if (!draw) {
        unmatched += part.amount
        continue
      }
      draw.repaid += part.amount
      if (!draw.repayments.includes(entry.signature)) draw.repayments.push(entry.signature)
    }
  }
  const list = [...draws.values()].sort((a, b) => b.drawnAt - a.drawnAt || b.dueAt - a.dueAt)
  const total = (pick: (draw: ArfDraw) => bigint) => list.reduce((sum, draw) => sum + pick(draw), 0n)
  return {
    draws: list,
    outstanding: total(owed),
    drawn: total((draw) => draw.amount),
    fees: total((draw) => draw.fee),
    repaid: total((draw) => draw.repaid),
    overdue: list.filter((draw) => arfStatus(draw, now) === 'overdue').length,
    unmatched,
  }
}

export function arfDraw(ledger: ArfLedger, terms: ArfTerms, amount: bigint, liquidity: bigint, now: number): { fee: bigint; dueAt: number } | { refused: ArfRefusal } {
  const fee = (amount * BigInt(terms.feeBps) + 9_999n) / 10_000n
  if (ledger.overdue > 0) return { refused: 'overdue' }
  if (ledger.outstanding + amount + fee > terms.limit) return { refused: 'limit' }
  if (liquidity < amount) return { refused: 'liquidity' }
  return { fee, dueAt: now + terms.termSeconds }
}

export function arfAllocate(ledger: ArfLedger, available: bigint): { id: string; amount: bigint }[] {
  const parts: { id: string; amount: bigint }[] = []
  let left = available
  for (const draw of [...ledger.draws].sort((a, b) => a.dueAt - b.dueAt || a.drawnAt - b.drawnAt)) {
    if (left <= 0n || parts.length >= ARF_MAX_REPAY_PARTS) break
    const due = owed(draw)
    if (due === 0n) continue
    const amount = due < left ? due : left
    parts.push({ id: draw.id, amount })
    left -= amount
  }
  return parts
}

function requireArf(e: Env): { facility: Keypair; terms: ArfTerms } {
  if (!e.arf) throw new RailError('the Arf sandbox facility is not configured', 503)
  if (typeof e.arfTerms === 'string') throw new RailError(e.arfTerms, 500)
  return { facility: e.arf, terms: e.arfTerms }
}

function arfKeys(e: Env, facility: Keypair, treasury: Keypair): ArfKeys {
  const mint = new PublicKey(e.usdcMint)
  return {
    facility: facility.publicKey.toBase58(),
    facilityAta: getAssociatedTokenAddressSync(mint, facility.publicKey).toBase58(),
    treasury: treasury.publicKey.toBase58(),
    treasuryAta: getAssociatedTokenAddressSync(mint, treasury.publicKey).toBase58(),
    mint: e.usdcMint,
  }
}

const arfTransactions = new Map<string, ParsedTransactionWithMeta>()

export async function arfEntries(e: Pick<Env, 'connection'>, keys: ArfKeys): Promise<ArfEntry[]> {
  const history = await e.connection.getSignaturesForAddress(new PublicKey(keys.facilityAta), { limit: ARF_HISTORY_LIMIT })
  const signatures = history.filter((entry) => !entry.err && /ARF-(DRAW|REPAY) /.test(entry.memo ?? '')).map((entry) => entry.signature)
  for (const signature of signatures) {
    if (arfTransactions.has(signature)) continue
    const tx = await e.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    if (!tx) throw new RailError(`Arf ledger transaction ${signature} is not readable yet, try again`, 503)
    arfTransactions.set(signature, tx)
  }
  const current = new Set(signatures)
  for (const signature of arfTransactions.keys()) if (!current.has(signature)) arfTransactions.delete(signature)
  return signatures.flatMap((signature) => {
    const tx = arfTransactions.get(signature)
    const entry = tx ? readArfEntry(tx, signature, keys) : null
    return entry ? [entry] : []
  })
}

async function arfSweep(e: Env) {
  const treasury = requireTreasury(e)
  const { facility } = requireArf(e)
  const keys = arfKeys(e, facility, treasury)
  const mint = new PublicKey(e.usdcMint)
  const treasuryAta = new PublicKey(keys.treasuryAta)
  const facilityAta = new PublicKey(keys.facilityAta)
  const [entries, available] = await Promise.all([arfEntries(e, keys), tokenUnits(e, treasuryAta)])
  const parts = arfAllocate(arfLedger(entries, Math.floor(Date.now() / 1000)), available)
  if (parts.length === 0) return { repaid: 0, draws: [] }
  const total = parts.reduce((sum, part) => sum + part.amount, 0n)
  const signature = await submit(e, treasury, [
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, facilityAta, facility.publicKey, mint),
    createTransferCheckedInstruction(treasuryAta, mint, facilityAta, treasury.publicKey, total, USDC_DECIMALS),
    createMemoInstruction(repayMemo(parts), [treasury.publicKey]),
  ])
  return { repaid: toUsdc(total), signature, draws: parts.map((part) => ({ id: part.id, amount: toUsdc(part.amount) })) }
}

async function arfState(e: Env) {
  if (!e.arf) return { enabled: false }
  const treasury = requireTreasury(e)
  const { facility, terms } = requireArf(e)
  const keys = arfKeys(e, facility, treasury)
  const now = Math.floor(Date.now() / 1000)
  const [entries, liquidity] = await Promise.all([arfEntries(e, keys), tokenUnits(e, new PublicKey(keys.facilityAta))])
  const ledger = arfLedger(entries, now)
  return {
    enabled: true,
    sandbox: true,
    facility: keys.facility,
    limit: toUsdc(terms.limit),
    termDays: terms.termSeconds / 86_400,
    feeBps: terms.feeBps,
    outstanding: toUsdc(ledger.outstanding),
    available: toUsdc(ledger.outstanding >= terms.limit ? 0n : terms.limit - ledger.outstanding),
    liquidity: toUsdc(liquidity),
    drawn: toUsdc(ledger.drawn),
    fees: toUsdc(ledger.fees),
    repaid: toUsdc(ledger.repaid),
    overdue: ledger.overdue,
    count: ledger.draws.length,
    draws: ledger.draws.slice(0, 10).map((draw) => ({
      id: draw.id,
      ref: draw.ref,
      amount: toUsdc(draw.amount),
      fee: toUsdc(draw.fee),
      repaid: toUsdc(draw.repaid),
      owed: toUsdc(owed(draw)),
      drawnAt: draw.drawnAt,
      dueAt: draw.dueAt,
      status: arfStatus(draw, now),
      signature: draw.signature,
      repayments: draw.repayments,
    })),
    updatedAt: now,
  }
}

async function settleDeposit(e: Env, body: Json) {
  const treasury = requireTreasury(e)
  const payload = verify(e, String(body.token), 'deposit')
  const mint = new PublicKey(e.usdcMint)
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey)
  const recent = await e.connection.getSignaturesForAddress(treasuryAta, { limit: 100 })
  const previous = recent.find((entry) => entry.memo?.includes(String(payload.id)) && !entry.err)
  if (previous) return { id: payload.id, status: 'completed', sandbox: true, amountOut: Number(payload.usdc) / 10 ** USDC_DECIMALS, signature: previous.signature, reused: true, funding: fundingOf(previous.memo ?? '') }
  const amount = BigInt(String(payload.usdc))
  const user = new PublicKey(String(payload.account))
  await requireRepayment(e, user, amount)
  const userAta = getAssociatedTokenAddressSync(mint, user)
  const payUser = [
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, userAta, user, mint),
    createTransferCheckedInstruction(treasuryAta, mint, userAta, treasury.publicKey, amount, USDC_DECIMALS),
  ]
  let refused: ArfRefusal | null = null
  if (e.arf) {
    const { facility, terms } = requireArf(e)
    const keys = arfKeys(e, facility, treasury)
    const facilityAta = new PublicKey(keys.facilityAta)
    const now = Math.floor(Date.now() / 1000)
    const [entries, liquidity] = await Promise.all([arfEntries(e, keys), tokenUnits(e, facilityAta)])
    const draw = arfDraw(arfLedger(entries, now), terms, amount, liquidity, now)
    if ('refused' in draw) {
      refused = draw.refused
    } else {
      const id = arfDrawId(String(payload.id))
      const signature = await submit(
        e,
        treasury,
        [
          createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, treasuryAta, treasury.publicKey, mint),
          createTransferCheckedInstruction(facilityAta, mint, treasuryAta, facility.publicKey, amount, USDC_DECIMALS),
          ...payUser,
          createMemoInstruction(drawMemo({ id, amount, fee: draw.fee, dueAt: draw.dueAt, ref: String(payload.id) }), [treasury.publicKey, facility.publicKey]),
        ],
        [facility],
      )
      return { id: payload.id, status: 'completed', sandbox: true, amountOut: toUsdc(amount), signature, funding: { source: 'arf', drawId: id, fee: toUsdc(draw.fee), dueAt: draw.dueAt } }
    }
  }
  if ((await tokenUnits(e, treasuryAta)) < amount) {
    throw new RailError(refused ? `the Arf facility cannot fund this deposit (${ARF_REFUSALS[refused]}) and the sandbox treasury does not hold enough devnet USDC` : 'the sandbox treasury does not hold enough devnet USDC, cash out first or top it up', 409)
  }
  const signature = await submit(e, treasury, [...payUser, createMemoInstruction(String(payload.id), [treasury.publicKey])])
  return { id: payload.id, status: 'completed', sandbox: true, amountOut: toUsdc(amount), signature, funding: refused ? { source: 'treasury', reason: refused } : { source: 'treasury' } }
}

async function treasuryState(e: Env) {
  const treasury = requireTreasury(e)
  const ata = getAssociatedTokenAddressSync(new PublicKey(e.usdcMint), treasury.publicKey)
  const balance = await e.connection.getTokenAccountBalance(ata).catch(() => null)
  return { treasury: treasury.publicKey.toBase58(), usdc: balance ? Number(balance.value.uiAmountString ?? 0) : 0, limits: LIMITS, feeRate: FEE_RATE }
}

export async function handleRail(request: Request): Promise<Response> {
  const e = env()
  const url = new URL(request.url)
  const action = url.searchParams.get('action') ?? ''
  try {
    if (request.method === 'GET') {
      if (action === 'fx') return json(await tryPerUsd(e))
      if (action === 'fx-history') return json(await fxHistory(e))
      if (action === 'sol') {
        const price = await cached('sol', 10_000, () => pyth(e, PYTH_SOL_USD))
        return price ? json({ solUsd: price.price, publishTime: price.publishTime, source: 'pyth' }) : json({ error: 'no Pyth key or feed' }, 404)
      }
      if (action === 'sol-history') return json(await solHistory(e, url.searchParams.get('range') ?? '24h'))
      if (action === 'quote') {
        const fx = await tryPerUsd(e)
        return json({ ...quote(fx.tryPerUsd, url.searchParams.get('side') ?? 'cashout', Number(url.searchParams.get('amount'))), source: fx.source })
      }
      if (action === 'treasury') return json(await treasuryState(e))
      if (action === 'arf') return json(await arfState(e))
    }
    if (request.method === 'POST') {
      if (action === 'arf-sweep') return json(await arfSweep(e))
      const body = (await request.json()) as Json
      if (action === 'payout') return json(await startPayout(e, body))
      if (action === 'confirm') return json(await confirmPayout(e, body))
      if (action === 'deposit') return json(await startDeposit(e, body))
      if (action === 'settle') return json(await settleDeposit(e, body))
    }
    return json({ error: `unknown action ${request.method} ${action}` }, 404)
  } catch (error) {
    const status = error instanceof RailError ? error.status : 500
    return json({ error: error instanceof Error ? error.message : String(error) }, status)
  }
}

export function GET(request: Request): Promise<Response> {
  return handleRail(request)
}

export function POST(request: Request): Promise<Response> {
  return handleRail(request)
}
