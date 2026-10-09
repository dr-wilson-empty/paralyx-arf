import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type ParsedInstruction, type PartiallyDecodedInstruction } from '@solana/web3.js'
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

type Json = Record<string, unknown>

interface Env {
  treasury: Keypair | null
  connection: Connection
  usdcMint: string
  pythKey: string | null
  signingKey: Buffer
}

function env(): Env {
  const secret = process.env.SANDBOX_TREASURY_SECRET ?? ''
  const treasury = secret ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[])) : null
  return {
    treasury,
    connection: new Connection(process.env.RAIL_RPC ?? 'https://api.devnet.solana.com', 'confirmed'),
    usdcMint: process.env.RAIL_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
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
  const memoMatches = instructions.some((ix) => 'parsed' in ix && (ix.program === 'spl-memo' || ix.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') && String(ix.parsed) === payload.id)
  if (!paid) throw new RailError('the transaction does not pay the quoted USDC to the sandbox treasury')
  if (!memoMatches) throw new RailError('the transaction memo does not match the payout id')
  return {
    id: payload.id,
    status: 'completed',
    sandbox: true,
    amountIn: Number(payload.usdc) / 10 ** USDC_DECIMALS,
    amountOut: Number(payload.tryAmount),
    externalTransactionId: reference(`${payload.id}:${signature}`),
    signature,
  }
}

async function startDeposit(e: Env, body: Json) {
  requireTreasury(e)
  const tryAmount = Number(body.tryAmount)
  const account = new PublicKey(String(body.account)).toBase58()
  if (!(tryAmount >= LIMITS.minTry && tryAmount <= LIMITS.maxTry)) throw new RailError(`amount must be between ${LIMITS.minTry} and ${LIMITS.maxTry} TRY`)
  const fx = await tryPerUsd(e)
  const q = quote(fx.tryPerUsd, 'repay', tryAmount)
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

async function settleDeposit(e: Env, body: Json) {
  const treasury = requireTreasury(e)
  const payload = verify(e, String(body.token), 'deposit')
  const mint = new PublicKey(e.usdcMint)
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey)
  const recent = await e.connection.getSignaturesForAddress(treasuryAta, { limit: 100 })
  const previous = recent.find((entry) => entry.memo?.includes(String(payload.id)) && !entry.err)
  if (previous) return { id: payload.id, status: 'completed', sandbox: true, amountOut: Number(payload.usdc) / 10 ** USDC_DECIMALS, signature: previous.signature, reused: true }
  const amount = BigInt(String(payload.usdc))
  const balance = await e.connection.getTokenAccountBalance(treasuryAta).catch(() => null)
  if (!balance || BigInt(balance.value.amount) < amount) throw new RailError('the sandbox treasury does not hold enough devnet USDC, cash out first or top it up', 409)
  const user = new PublicKey(String(payload.account))
  const userAta = getAssociatedTokenAddressSync(mint, user)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, userAta, user, mint),
    createTransferCheckedInstruction(treasuryAta, mint, userAta, treasury.publicKey, amount, USDC_DECIMALS),
    createMemoInstruction(String(payload.id), [treasury.publicKey]),
  )
  const signature = await sendAndConfirmTransaction(e.connection, tx, [treasury], { commitment: 'confirmed' })
  return { id: payload.id, status: 'completed', sandbox: true, amountOut: Number(amount) / 10 ** USDC_DECIMALS, signature }
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
    }
    if (request.method === 'POST') {
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
