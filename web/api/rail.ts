import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, type AccountMeta, type ParsedInstruction, type PartiallyDecodedInstruction, type SignatureStatus } from '@solana/web3.js'
import { Account, Contract, Keypair as StellarKeypair, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { createMemoInstruction } from '@solana/spl-memo'
import bs58 from 'bs58'

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
export const ARF_PROGRAM = 'ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC'
const ARF_MAX_REPAY_DRAWS = 8

type Json = Record<string, unknown>

interface Env {
  treasury: Keypair | null
  arfProgram: PublicKey
  arfLine: PublicKey | null
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

function env(): Env {
  const secret = process.env.SANDBOX_TREASURY_SECRET ?? ''
  return {
    treasury: keypair(secret),
    arfProgram: new PublicKey(process.env.ARF_PROGRAM || ARF_PROGRAM),
    arfLine: process.env.ARF_LINE ? new PublicKey(process.env.ARF_LINE) : null,
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
  if (!e.arfLine) return settlement
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

async function submit(e: Env, payer: Keypair, instructions: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(...instructions)
  const latest = await e.connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  tx.feePayer = payer.publicKey
  tx.sign(payer)
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

export interface ArfLineState {
  address: PublicKey
  provider: PublicKey
  operator: PublicKey
  mint: PublicKey
  vault: PublicKey
  limit: bigint
  termSeconds: number
  feeBps: number
  frozen: boolean
  outstanding: bigint
  drawn: bigint
  fees: bigint
  repaid: bigint
  nextSeq: bigint
  headSeq: bigint
  headDueAt: number
}

export interface ArfDrawState {
  address: PublicKey
  line: PublicKey
  seq: bigint
  destination: PublicKey
  amount: bigint
  fee: bigint
  repaid: bigint
  drawnAt: number
  dueAt: number
  reference: string
}

export type ArfRefusal = 'frozen' | 'overdue' | 'limit' | 'liquidity'

const ARF_REFUSALS: Record<ArfRefusal, string> = {
  frozen: 'Arf froze the line',
  overdue: 'a draw is past its due date',
  limit: 'the line limit is reached',
  liquidity: 'the line holds too little devnet USDC',
}

function discriminator(namespace: string, name: string): Buffer {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8)
}

export const ARF_DISCRIMINATORS = {
  createLine: discriminator('global', 'create_line'),
  fund: discriminator('global', 'fund'),
  withdraw: discriminator('global', 'withdraw'),
  setTerms: discriminator('global', 'set_terms'),
  draw: discriminator('global', 'draw'),
  repay: discriminator('global', 'repay'),
  line: discriminator('account', 'Line'),
  drawAccount: discriminator('account', 'Draw'),
}

export function arfLineAddress(program: PublicKey, provider: PublicKey, operator: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('line'), provider.toBuffer(), operator.toBuffer(), mint.toBuffer()], program)[0]
}

export function arfVaultAddress(program: PublicKey, line: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), line.toBuffer()], program)[0]
}

export function arfDrawAddress(program: PublicKey, line: PublicKey, reference: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('draw'), line.toBuffer(), Buffer.from(reference, 'utf8')], program)[0]
}

function arfEventAuthority(program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], program)[0]
}

export function decodeArfLine(address: PublicKey, data: Buffer): ArfLineState {
  if (data.length < 214 || !data.subarray(0, 8).equals(ARF_DISCRIMINATORS.line)) throw new RailError('the account is not an Arf line', 500)
  const key = (at: number) => new PublicKey(data.subarray(at, at + 32))
  return {
    address,
    provider: key(8),
    operator: key(40),
    mint: key(72),
    vault: key(104),
    limit: data.readBigUInt64LE(136),
    termSeconds: Number(data.readBigInt64LE(144)),
    feeBps: data.readUInt16LE(152),
    frozen: data[154] === 1,
    outstanding: data.readBigUInt64LE(155),
    drawn: data.readBigUInt64LE(163),
    fees: data.readBigUInt64LE(171),
    repaid: data.readBigUInt64LE(179),
    nextSeq: data.readBigUInt64LE(187),
    headSeq: data.readBigUInt64LE(195),
    headDueAt: Number(data.readBigInt64LE(203)),
  }
}

export function decodeArfDraw(address: PublicKey, data: Buffer): ArfDrawState {
  if (data.length < 158 || !data.subarray(0, 8).equals(ARF_DISCRIMINATORS.drawAccount)) throw new RailError('the account is not an Arf draw', 500)
  const length = data.readUInt32LE(154)
  return {
    address,
    line: new PublicKey(data.subarray(8, 40)),
    seq: data.readBigUInt64LE(40),
    destination: new PublicKey(data.subarray(48, 80)),
    amount: data.readBigUInt64LE(80),
    fee: data.readBigUInt64LE(88),
    repaid: data.readBigUInt64LE(96),
    drawnAt: Number(data.readBigInt64LE(104)),
    dueAt: Number(data.readBigInt64LE(112)),
    reference: data.subarray(158, 158 + length).toString('utf8'),
  }
}

export function arfFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps) + 9_999n) / 10_000n
}

export function arfOwed(draw: Pick<ArfDrawState, 'amount' | 'fee' | 'repaid'>): bigint {
  const total = draw.amount + draw.fee
  return draw.repaid >= total ? 0n : total - draw.repaid
}

export function arfOpenDraws(line: Pick<ArfLineState, 'headSeq'>, draws: ArfDrawState[]): ArfDrawState[] {
  return draws.filter((draw) => draw.seq >= line.headSeq).sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
}

export function arfStatus(line: Pick<ArfLineState, 'headSeq'>, draw: ArfDrawState, now: number): 'repaid' | 'overdue' | 'open' {
  if (draw.seq < line.headSeq || arfOwed(draw) === 0n) return 'repaid'
  return draw.dueAt < now ? 'overdue' : 'open'
}

export function arfRefusal(line: ArfLineState, amount: bigint, liquidity: bigint, now: number): ArfRefusal | null {
  if (line.frozen) return 'frozen'
  if (line.headSeq < line.nextSeq && now > line.headDueAt) return 'overdue'
  if (line.outstanding + amount + arfFee(amount, line.feeBps) > line.limit) return 'limit'
  if (liquidity < amount) return 'liquidity'
  return null
}

export function arfAllocate(open: ArfDrawState[], available: bigint): { amount: bigint; accounts: PublicKey[]; parts: { seq: bigint; reference: string; amount: bigint }[] } {
  const parts: { seq: bigint; reference: string; amount: bigint }[] = []
  let left = available
  for (const draw of open.slice(0, ARF_MAX_REPAY_DRAWS)) {
    const due = arfOwed(draw)
    if (left === 0n || due === 0n) break
    const amount = due < left ? due : left
    parts.push({ seq: draw.seq, reference: draw.reference, amount })
    left -= amount
    if (amount < due) break
  }
  const amount = parts.reduce((sum, part) => sum + part.amount, 0n)
  return { amount, accounts: open.slice(0, Math.min(open.length, parts.length + 1)).map((draw) => draw.address), parts }
}

function accountMeta(pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable }
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(value)
  return buffer
}

function i64(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64LE(BigInt(value))
  return buffer
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function text(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bytes.length)
  return Buffer.concat([length, bytes])
}

function arfInstruction(program: PublicKey, keys: AccountMeta[], data: Buffer, remaining: AccountMeta[] = []): TransactionInstruction {
  return new TransactionInstruction({ programId: program, keys: [...keys, accountMeta(arfEventAuthority(program)), accountMeta(program), ...remaining], data })
}

export function arfCreateLineIx(program: PublicKey, provider: PublicKey, operator: PublicKey, mint: PublicKey, limit: bigint, termSeconds: number, feeBps: number, tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
  const line = arfLineAddress(program, provider, operator, mint)
  return arfInstruction(
    program,
    [accountMeta(provider, true, true), accountMeta(operator), accountMeta(mint), accountMeta(line, true), accountMeta(arfVaultAddress(program, line), true), accountMeta(tokenProgram), accountMeta(SystemProgram.programId)],
    Buffer.concat([ARF_DISCRIMINATORS.createLine, u64(limit), i64(termSeconds), u16(feeBps)]),
  )
}

type ArfLineKeys = Pick<ArfLineState, 'address' | 'mint' | 'vault'>

export function arfFundIx(program: PublicKey, line: ArfLineKeys, provider: PublicKey, source: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
  return arfInstruction(
    program,
    [accountMeta(provider, false, true), accountMeta(line.address), accountMeta(line.mint), accountMeta(line.vault, true), accountMeta(source, true), accountMeta(tokenProgram)],
    Buffer.concat([ARF_DISCRIMINATORS.fund, u64(amount)]),
  )
}

export function arfWithdrawIx(program: PublicKey, line: ArfLineKeys, provider: PublicKey, destination: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
  return arfInstruction(
    program,
    [accountMeta(provider, false, true), accountMeta(line.address), accountMeta(line.mint), accountMeta(line.vault, true), accountMeta(destination, true), accountMeta(tokenProgram)],
    Buffer.concat([ARF_DISCRIMINATORS.withdraw, u64(amount)]),
  )
}

export function arfSetTermsIx(program: PublicKey, line: PublicKey, provider: PublicKey, limit: bigint, termSeconds: number, feeBps: number, frozen: boolean): TransactionInstruction {
  return arfInstruction(program, [accountMeta(provider, false, true), accountMeta(line, true)], Buffer.concat([ARF_DISCRIMINATORS.setTerms, u64(limit), i64(termSeconds), u16(feeBps), Buffer.from([frozen ? 1 : 0])]))
}

export function arfDrawIx(program: PublicKey, line: ArfLineKeys, operator: PublicKey, reference: string, amount: bigint, destination: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
  return arfInstruction(
    program,
    [
      accountMeta(operator, true, true),
      accountMeta(line.address, true),
      accountMeta(arfDrawAddress(program, line.address, reference), true),
      accountMeta(line.mint),
      accountMeta(line.vault, true),
      accountMeta(destination, true),
      accountMeta(tokenProgram),
      accountMeta(SystemProgram.programId),
    ],
    Buffer.concat([ARF_DISCRIMINATORS.draw, text(reference), u64(amount)]),
  )
}

export function arfRepayIx(program: PublicKey, line: ArfLineKeys, payer: PublicKey, source: PublicKey, amount: bigint, draws: PublicKey[], tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
  return arfInstruction(
    program,
    [accountMeta(payer, false, true), accountMeta(line.address, true), accountMeta(line.mint), accountMeta(line.vault, true), accountMeta(source, true), accountMeta(tokenProgram)],
    Buffer.concat([ARF_DISCRIMINATORS.repay, u64(amount)]),
    draws.map((draw) => accountMeta(draw, true)),
  )
}

export async function readArf(e: Pick<Env, 'connection' | 'arfProgram' | 'usdcMint'>, address: PublicKey, operator: PublicKey, withDraws: boolean): Promise<{ line: ArfLineState; draws: ArfDrawState[]; liquidity: bigint }> {
  const vault = arfVaultAddress(e.arfProgram, address)
  const [[account, vaultAccount], accounts] = await Promise.all([
    e.connection.getMultipleAccountsInfo([address, vault]),
    withDraws
      ? e.connection.getProgramAccounts(e.arfProgram, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(ARF_DISCRIMINATORS.drawAccount) } }, { memcmp: { offset: 8, bytes: address.toBase58() } }] })
      : Promise.resolve([]),
  ])
  if (!account || !account.owner.equals(e.arfProgram)) throw new RailError('ARF_LINE is not an account of the Arf program', 500)
  const line = decodeArfLine(address, account.data)
  if (!line.operator.equals(operator)) throw new RailError("the Arf line's operator is not the sandbox treasury", 500)
  if (!line.mint.equals(new PublicKey(e.usdcMint)) || !line.vault.equals(vault)) throw new RailError('the Arf line lends another mint or names another vault', 500)
  const liquidity = vaultAccount && vaultAccount.data.length >= 72 ? vaultAccount.data.readBigUInt64LE(64) : 0n
  return { line, draws: accounts.map(({ pubkey, account: entry }) => decodeArfDraw(pubkey, entry.data)), liquidity }
}

function arfFunding(draw: ArfDrawState): Json {
  return { source: 'arf', seq: Number(draw.seq), reference: draw.reference, draw: draw.address.toBase58(), fee: toUsdc(draw.fee), dueAt: draw.dueAt }
}

async function arfSweep(e: Env) {
  const treasury = requireTreasury(e)
  if (!e.arfLine) throw new RailError('the Arf line is not configured', 503)
  const { line, draws } = await readArf(e, e.arfLine, treasury.publicKey, true)
  const treasuryAta = getAssociatedTokenAddressSync(new PublicKey(e.usdcMint), treasury.publicKey)
  const allocation = arfAllocate(arfOpenDraws(line, draws), await tokenUnits(e, treasuryAta))
  if (allocation.amount === 0n) return { repaid: 0, draws: [] }
  const signature = await submit(e, treasury, [arfRepayIx(e.arfProgram, line, treasury.publicKey, treasuryAta, allocation.amount, allocation.accounts)])
  return { repaid: toUsdc(allocation.amount), signature, draws: allocation.parts.map((part) => ({ seq: Number(part.seq), reference: part.reference, amount: toUsdc(part.amount) })) }
}

async function arfState(e: Env) {
  if (!e.arfLine) return { enabled: false }
  const treasury = requireTreasury(e)
  const { line, draws, liquidity } = await readArf(e, e.arfLine, treasury.publicKey, true)
  const now = Math.floor(Date.now() / 1000)
  return {
    enabled: true,
    sandbox: true,
    program: e.arfProgram.toBase58(),
    line: line.address.toBase58(),
    provider: line.provider.toBase58(),
    operator: line.operator.toBase58(),
    vault: line.vault.toBase58(),
    limit: toUsdc(line.limit),
    termDays: Math.round((line.termSeconds / 86_400) * 100) / 100,
    feeBps: line.feeBps,
    frozen: line.frozen,
    outstanding: toUsdc(line.outstanding),
    available: toUsdc(line.outstanding >= line.limit ? 0n : line.limit - line.outstanding),
    liquidity: toUsdc(liquidity),
    drawn: toUsdc(line.drawn),
    fees: toUsdc(line.fees),
    repaid: toUsdc(line.repaid),
    overdue: arfOpenDraws(line, draws).filter((draw) => draw.dueAt < now).length,
    count: Number(line.nextSeq),
    draws: [...draws]
      .sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0))
      .slice(0, 10)
      .map((draw) => ({
        seq: Number(draw.seq),
        reference: draw.reference,
        address: draw.address.toBase58(),
        amount: toUsdc(draw.amount),
        fee: toUsdc(draw.fee),
        repaid: toUsdc(draw.repaid),
        owed: toUsdc(arfOwed(draw)),
        drawnAt: draw.drawnAt,
        dueAt: draw.dueAt,
        status: arfStatus(line, draw, now),
      })),
    updatedAt: now,
  }
}

async function settleDeposit(e: Env, body: Json) {
  const treasury = requireTreasury(e)
  const payload = verify(e, String(body.token), 'deposit')
  const id = String(payload.id)
  const mint = new PublicKey(e.usdcMint)
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey)
  const drawn = async () => {
    if (!e.arfLine) return null
    const drawAddress = arfDrawAddress(e.arfProgram, e.arfLine, id)
    const existing = await e.connection.getAccountInfo(drawAddress)
    if (!existing) return null
    const history = await e.connection.getSignaturesForAddress(drawAddress, { limit: 100 })
    return { id, status: 'completed', sandbox: true, amountOut: Number(payload.usdc) / 10 ** USDC_DECIMALS, signature: history.at(-1)?.signature, reused: true, funding: arfFunding(decodeArfDraw(drawAddress, existing.data)) }
  }
  const earlier = await drawn()
  if (earlier) return earlier
  const recent = await e.connection.getSignaturesForAddress(treasuryAta, { limit: 100 })
  const previous = recent.find((entry) => entry.memo?.includes(id) && !entry.err)
  if (previous) return { id, status: 'completed', sandbox: true, amountOut: Number(payload.usdc) / 10 ** USDC_DECIMALS, signature: previous.signature, reused: true, funding: { source: 'treasury' } }
  const amount = BigInt(String(payload.usdc))
  const user = new PublicKey(String(payload.account))
  await requireRepayment(e, user, amount)
  const userAta = getAssociatedTokenAddressSync(mint, user)
  const openAta = createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, userAta, user, mint)
  let refused: ArfRefusal | null = null
  if (e.arfLine) {
    const { line, liquidity } = await readArf(e, e.arfLine, treasury.publicKey, false)
    refused = arfRefusal(line, amount, liquidity, Math.floor(Date.now() / 1000))
    if (!refused) {
      let signature: string
      try {
        signature = await submit(e, treasury, [openAta, arfDrawIx(e.arfProgram, line, treasury.publicKey, id, amount, userAta), createMemoInstruction(id, [treasury.publicKey])])
      } catch (error) {
        const raced = await drawn()
        if (raced) return raced
        throw error
      }
      const drawAddress = arfDrawAddress(e.arfProgram, line.address, id)
      const created = await e.connection.getAccountInfo(drawAddress)
      return { id, status: 'completed', sandbox: true, amountOut: toUsdc(amount), signature, funding: created ? arfFunding(decodeArfDraw(drawAddress, created.data)) : { source: 'arf', reference: id, draw: drawAddress.toBase58() } }
    }
  }
  if ((await tokenUnits(e, treasuryAta)) < amount) {
    throw new RailError(refused ? `the Arf line cannot fund this deposit (${ARF_REFUSALS[refused]}) and the sandbox treasury does not hold enough devnet USDC` : 'the sandbox treasury does not hold enough devnet USDC, cash out first or top it up', 409)
  }
  const signature = await submit(e, treasury, [openAta, createTransferCheckedInstruction(treasuryAta, mint, userAta, treasury.publicKey, amount, USDC_DECIMALS), createMemoInstruction(id, [treasury.publicKey])])
  return { id, status: 'completed', sandbox: true, amountOut: toUsdc(amount), signature, funding: refused ? { source: 'treasury', reason: refused } : { source: 'treasury' } }
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
