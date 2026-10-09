import { Buffer } from 'buffer'
import bs58 from 'bs58'
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, type Connection, type ParsedTransactionWithMeta } from '@solana/web3.js'

export const KLEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'
export const FARMS_PROGRAM = 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
export const LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111'
export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111'
export const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111'
export const DEFAULT_KEY = '11111111111111111111111111111111'

const IX = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  openLine: [99, 104, 130, 198, 128, 34, 27, 208],
  repayLine: [179, 153, 164, 4, 142, 223, 36, 201],
  recordPayout: [227, 164, 213, 54, 69, 172, 31, 216],
  initUserMetadata: [117, 169, 176, 69, 197, 23, 15, 162],
  initObligation: [251, 10, 231, 76, 27, 11, 159, 96],
  initObligationFarms: [136, 63, 15, 186, 211, 152, 168, 164],
}
const ACCOUNT = {
  config: [155, 12, 170, 224, 30, 250, 204, 130],
  line: [15, 73, 125, 153, 180, 13, 80, 187],
}
const EVENT = {
  opened: [200, 206, 237, 128, 16, 167, 83, 72],
  repaid: [127, 110, 23, 12, 105, 66, 127, 175],
  payout: [223, 72, 62, 120, 174, 225, 116, 220],
}
const EVENT_IX_TAG = [228, 69, 165, 46, 81, 203, 154, 29]
export const U64_MAX = 18_446_744_073_709_551_615n

export interface Oracles {
  pyth: string | null
  switchboardPrice: string | null
  switchboardTwap: string | null
  scope: string | null
}

export interface ReserveAccounts {
  address: string
  market: string
  mint: string
  decimals: number
  supply: string
  feeVault: string
  tokenProgram: string
  ctokenMint: string
  ctokenSupply: string
  farmCollateral: string | null
  farmDebt: string | null
  oracles: Oracles
  status: number
  loanToValuePct: number
  liquidationThresholdPct: number
  symbol: string
}

export interface Deployment {
  program: string
  klend: string
  farms: string
  market: string
  collateral: ReserveAccounts
  debt: ReserveAccounts
}

export interface ConfigAccount {
  admin: string
  klendProgram: string
  lendingMarket: string
  collateralReserve: string
  debtReserve: string
  lineCount: number
}

export interface LineAccount {
  user: string
  openedAt: number
  updatedAt: number
  collateralIn: bigint
  collateralOut: bigint
  borrowed: bigint
  repaid: bigint
  payouts: number
  payoutTry: bigint
}

export type EventKind = 'opened' | 'repaid' | 'payout'

export interface LineEvent {
  kind: EventKind
  user: string
  a: bigint
  b: bigint
  railTxId?: string
}

function key(value: string | PublicKey): PublicKey {
  return typeof value === 'string' ? new PublicKey(value) : value
}

function readKey(data: Uint8Array, offset: number): string {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58()
}

function optionalKey(data: Uint8Array, offset: number): string | null {
  const value = readKey(data, offset)
  return value === DEFAULT_KEY ? null : value
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(value)
  return bytes
}

function sameBytes(data: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((byte, index) => data[offset + index] === byte)
}

export function pda(seeds: (Uint8Array | string)[], program: string | PublicKey): PublicKey {
  const buffers = seeds.map((seed) => (typeof seed === 'string' ? Buffer.from(seed) : Buffer.from(seed)))
  return PublicKey.findProgramAddressSync(buffers, key(program))[0]
}

export function configAddress(program: string): PublicKey {
  return pda(['config'], program)
}

export function lineAddress(program: string, user: string | PublicKey): PublicKey {
  return pda(['line', key(user).toBytes()], program)
}

export function eventAuthority(program: string): PublicKey {
  return pda(['__event_authority'], program)
}

export function obligationAddress(klend: string, market: string, user: string | PublicKey): PublicKey {
  const zero = new Uint8Array(32)
  return pda([new Uint8Array([0]), new Uint8Array([0]), key(user).toBytes(), key(market).toBytes(), zero, zero], klend)
}

export function userMetadataAddress(klend: string, user: string | PublicKey): PublicKey {
  return pda(['user_meta', key(user).toBytes()], klend)
}

export function marketAuthority(klend: string, market: string): PublicKey {
  return pda(['lma', key(market).toBytes()], klend)
}

export function farmUserAddress(farms: string, farmState: string, obligation: PublicKey): PublicKey {
  return pda(['user', key(farmState).toBytes(), obligation.toBytes()], farms)
}

export function ataAddress(owner: string | PublicKey, mint: string, tokenProgram = TOKEN_PROGRAM): PublicKey {
  return pda([key(owner).toBytes(), key(tokenProgram).toBytes(), key(mint).toBytes()], ATA_PROGRAM)
}

export function decodeReserve(address: string, data: Uint8Array): ReserveAccounts {
  const name = Buffer.from(data.subarray(5032, 5064)).toString('utf8').replace(/\0+$/, '')
  return {
    address,
    market: readKey(data, 32),
    farmCollateral: optionalKey(data, 64),
    farmDebt: optionalKey(data, 96),
    mint: readKey(data, 128),
    supply: readKey(data, 160),
    feeVault: readKey(data, 192),
    decimals: Number(view(data).getBigUint64(272, true)),
    tokenProgram: readKey(data, 408),
    ctokenMint: readKey(data, 2560),
    ctokenSupply: readKey(data, 2600),
    status: data[4856],
    loanToValuePct: data[4872],
    liquidationThresholdPct: data[4873],
    oracles: {
      scope: optionalKey(data, 5112),
      switchboardPrice: optionalKey(data, 5160),
      switchboardTwap: optionalKey(data, 5192),
      pyth: optionalKey(data, 5224),
    },
    symbol: name,
  }
}

export interface MarketFlags {
  owner: string
  emergencyMode: boolean
  borrowDisabled: boolean
  name: string
}

export function decodeMarket(data: Uint8Array): MarketFlags {
  return {
    owner: readKey(data, 24),
    emergencyMode: data[122] > 0,
    borrowDisabled: data[124] > 0,
    name: Buffer.from(data.subarray(3248, 3280)).toString('utf8').replace(/\0+$/, ''),
  }
}

export function decodeConfig(data: Uint8Array): ConfigAccount | null {
  if (data.length < 8 + 32 * 5 + 8 || !sameBytes(data, 0, ACCOUNT.config)) return null
  return {
    admin: readKey(data, 8),
    klendProgram: readKey(data, 40),
    lendingMarket: readKey(data, 72),
    collateralReserve: readKey(data, 104),
    debtReserve: readKey(data, 136),
    lineCount: Number(view(data).getBigUint64(168, true)),
  }
}

export function decodeLine(data: Uint8Array): LineAccount | null {
  if (data.length < 8 + 32 + 8 * 6 + 4 + 8 || !sameBytes(data, 0, ACCOUNT.line)) return null
  const v = view(data)
  return {
    user: readKey(data, 8),
    openedAt: Number(v.getBigInt64(40, true)),
    updatedAt: Number(v.getBigInt64(48, true)),
    collateralIn: v.getBigUint64(56, true),
    collateralOut: v.getBigUint64(64, true),
    borrowed: v.getBigUint64(72, true),
    repaid: v.getBigUint64(80, true),
    payouts: v.getUint32(88, true),
    payoutTry: v.getBigUint64(92, true),
  }
}

export function decodeEvent(data: Uint8Array): LineEvent | null {
  if (data.length < 16 + 32 || !sameBytes(data, 0, EVENT_IX_TAG)) return null
  const body = data.subarray(16)
  const v = view(body)
  const user = readKey(body, 0)
  if (sameBytes(data, 8, EVENT.opened)) return { kind: 'opened', user, a: v.getBigUint64(32, true), b: v.getBigUint64(40, true) }
  if (sameBytes(data, 8, EVENT.repaid)) return { kind: 'repaid', user, a: v.getBigUint64(32, true), b: v.getBigUint64(40, true) }
  if (sameBytes(data, 8, EVENT.payout)) {
    const length = v.getUint32(32, true)
    const railTxId = Buffer.from(body.subarray(36, 36 + length)).toString('utf8')
    return { kind: 'payout', user, a: v.getBigUint64(36 + length, true), b: 0n, railTxId }
  }
  return null
}

export function eventsFromTransaction(transaction: ParsedTransactionWithMeta | null, programId: string): (LineEvent & { signature: string; slot: number; blockTime: number | null })[] {
  if (!transaction || transaction.meta?.err) return []
  const signature = transaction.transaction.signatures[0]
  const found: (LineEvent & { signature: string; slot: number; blockTime: number | null })[] = []
  for (const group of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      if (instruction.programId.toBase58() !== programId || !('data' in instruction)) continue
      const decoded = decodeEvent(bs58.decode(instruction.data))
      if (decoded) found.push({ ...decoded, signature, slot: transaction.slot, blockTime: transaction.blockTime ?? null })
    }
  }
  return found
}

function meta(pubkey: string | PublicKey, isWritable = false, isSigner = false) {
  return { pubkey: key(pubkey), isWritable, isSigner }
}

function optional(value: string | null, program: string, isWritable = false) {
  return value ? meta(value, isWritable) : meta(program)
}

export function computeBudget(units: number, microLamports = 0): TransactionInstruction[] {
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units })]
  if (microLamports > 0) instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }))
  return instructions
}

export function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: string, tokenProgram = TOKEN_PROGRAM): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(ATA_PROGRAM),
    keys: [
      meta(payer, true, true),
      meta(ataAddress(owner, mint, tokenProgram), true),
      meta(owner),
      meta(mint),
      meta(SystemProgram.programId),
      meta(tokenProgram),
    ],
    data: Buffer.from([1]),
  })
}

export function wrapSol(owner: PublicKey, lamports: bigint): TransactionInstruction[] {
  const account = ataAddress(owner, SOL_MINT)
  return [
    createAtaIdempotent(owner, owner, SOL_MINT),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: account, lamports }),
    new TransactionInstruction({ programId: key(TOKEN_PROGRAM), keys: [meta(account, true)], data: Buffer.from([17]) }),
  ]
}

export function closeTokenAccount(account: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(TOKEN_PROGRAM),
    keys: [meta(account, true), meta(owner, true), meta(owner, false, true)],
    data: Buffer.from([9]),
  })
}

export function transferChecked(source: PublicKey, mint: string, destination: PublicKey, owner: PublicKey, amount: bigint, decimals: number): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(TOKEN_PROGRAM),
    keys: [meta(source, true), meta(mint), meta(destination, true), meta(owner, false, true)],
    data: Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])]),
  })
}

export function memo(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: key(MEMO_PROGRAM), keys: [meta(signer, false, true)], data: Buffer.from(text, 'utf8') })
}

export function initUserMetadata(d: Deployment, user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(d.klend),
    keys: [
      meta(user, false, true),
      meta(user, true, true),
      meta(userMetadataAddress(d.klend, user), true),
      meta(d.klend),
      meta(RENT_SYSVAR),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from(IX.initUserMetadata), Buffer.alloc(32)]),
  })
}

export function initObligation(d: Deployment, user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(d.klend),
    keys: [
      meta(user, false, true),
      meta(user, true, true),
      meta(obligationAddress(d.klend, d.market, user), true),
      meta(d.market),
      meta(DEFAULT_KEY),
      meta(DEFAULT_KEY),
      meta(userMetadataAddress(d.klend, user)),
      meta(RENT_SYSVAR),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from(IX.initObligation), Buffer.from([0, 0])]),
  })
}

export function initObligationFarm(d: Deployment, user: PublicKey, reserve: ReserveAccounts, mode: 0 | 1): TransactionInstruction {
  const farm = mode === 0 ? reserve.farmCollateral : reserve.farmDebt
  if (!farm) throw new Error('reserve has no farm for this mode')
  const obligation = obligationAddress(d.klend, d.market, user)
  return new TransactionInstruction({
    programId: key(d.klend),
    keys: [
      meta(user, true, true),
      meta(user),
      meta(obligation, true),
      meta(marketAuthority(d.klend, d.market)),
      meta(reserve.address, true),
      meta(farm, true),
      meta(farmUserAddress(d.farms, farm, obligation), true),
      meta(d.market),
      meta(d.farms),
      meta(RENT_SYSVAR),
      meta(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from(IX.initObligationFarms), Buffer.from([mode])]),
  })
}

function lineKeys(d: Deployment, user: PublicKey, opening: boolean) {
  const obligation = obligationAddress(d.klend, d.market, user)
  const c = d.collateral
  const t = d.debt
  const farmUser = (farm: string | null) => (farm ? farmUserAddress(d.farms, farm, obligation).toBase58() : null)
  const keys = [
    meta(user, true, true),
    meta(configAddress(d.program), opening),
    meta(lineAddress(d.program, user), true),
    meta(d.klend),
    meta(d.market),
    meta(marketAuthority(d.klend, d.market)),
    meta(obligation, true),
    meta(c.address, true),
    meta(c.mint),
    meta(c.supply, true),
    meta(c.ctokenMint, true),
    meta(c.ctokenSupply, true),
    meta(ataAddress(user, c.mint, c.tokenProgram), true),
    meta(t.address, true),
    meta(t.mint),
    meta(t.supply, true),
  ]
  if (opening) keys.push(meta(t.feeVault, true))
  keys.push(
    meta(ataAddress(user, t.mint, t.tokenProgram), true),
    optional(c.oracles.pyth, d.program),
    optional(c.oracles.switchboardPrice, d.program),
    optional(c.oracles.switchboardTwap, d.program),
    optional(c.oracles.scope, d.program),
    optional(t.oracles.pyth, d.program),
    optional(t.oracles.switchboardPrice, d.program),
    optional(t.oracles.switchboardTwap, d.program),
    optional(t.oracles.scope, d.program),
    optional(c.farmCollateral, d.program, true),
    optional(farmUser(c.farmCollateral), d.program, true),
    optional(t.farmDebt, d.program, true),
    optional(farmUser(t.farmDebt), d.program, true),
    meta(d.farms),
    meta(c.tokenProgram),
    meta(INSTRUCTIONS_SYSVAR),
  )
  if (opening) keys.push(meta(SystemProgram.programId))
  keys.push(meta(eventAuthority(d.program)), meta(d.program))
  return keys
}

export function openLine(d: Deployment, user: PublicKey, collateral: bigint, borrow: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(d.program),
    keys: lineKeys(d, user, true),
    data: Buffer.concat([Buffer.from(IX.openLine), u64(collateral), u64(borrow)]),
  })
}

export function repayLine(d: Deployment, user: PublicKey, repay: bigint, withdrawCtokens: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(d.program),
    keys: lineKeys(d, user, false),
    data: Buffer.concat([Buffer.from(IX.repayLine), u64(repay), u64(withdrawCtokens)]),
  })
}

export function recordPayout(d: Deployment, user: PublicKey, railTxId: string, tryKurus: bigint): TransactionInstruction {
  const id = Buffer.from(railTxId, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(id.length)
  return new TransactionInstruction({
    programId: key(d.program),
    keys: [meta(user, false, true), meta(lineAddress(d.program, user), true), meta(eventAuthority(d.program)), meta(d.program)],
    data: Buffer.concat([Buffer.from(IX.recordPayout), length, id, u64(tryKurus)]),
  })
}

export function initialize(d: Deployment, admin: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(d.program),
    keys: [
      meta(admin, true, true),
      meta(configAddress(d.program), true),
      meta(d.program),
      meta(pda([key(d.program).toBytes()], LOADER_UPGRADEABLE)),
      meta(d.klend),
      meta(d.market),
      meta(d.collateral.address),
      meta(d.debt.address),
      meta(SystemProgram.programId),
    ],
    data: Buffer.from(IX.initialize),
  })
}

export function staticAddresses(d: Deployment): string[] {
  const reserveKeys = (r: ReserveAccounts) => [r.address, r.mint, r.supply, r.feeVault, r.ctokenMint, r.ctokenSupply, r.tokenProgram, r.farmCollateral, r.farmDebt, ...Object.values(r.oracles)]
  const all = [
    d.program,
    configAddress(d.program).toBase58(),
    eventAuthority(d.program).toBase58(),
    d.klend,
    d.farms,
    d.market,
    marketAuthority(d.klend, d.market).toBase58(),
    ...reserveKeys(d.collateral),
    ...reserveKeys(d.debt),
    INSTRUCTIONS_SYSVAR,
    RENT_SYSVAR,
    SystemProgram.programId.toBase58(),
    ATA_PROGRAM,
    MEMO_PROGRAM,
    ComputeBudgetProgram.programId.toBase58(),
  ]
  return [...new Set(all.filter((value): value is string => Boolean(value)))]
}

export interface SetupState {
  metadata: boolean
  obligation: boolean
  collateralFarm: boolean
  debtFarm: boolean
}

export function setupAddresses(d: Deployment, user: PublicKey): PublicKey[] {
  const obligation = obligationAddress(d.klend, d.market, user)
  return [
    userMetadataAddress(d.klend, user),
    obligation,
    d.collateral.farmCollateral ? farmUserAddress(d.farms, d.collateral.farmCollateral, obligation) : obligation,
    d.debt.farmDebt ? farmUserAddress(d.farms, d.debt.farmDebt, obligation) : obligation,
  ]
}

export function openLineInstructions(d: Deployment, user: PublicKey, collateral: bigint, borrow: bigint, existing: SetupState): TransactionInstruction[] {
  const instructions = [...computeBudget(1_000_000, 50_000)]
  if (collateral > 0n) instructions.push(...wrapSol(user, collateral))
  instructions.push(createAtaIdempotent(user, user, d.debt.mint, d.debt.tokenProgram))
  if (!existing.metadata) instructions.push(initUserMetadata(d, user))
  if (!existing.obligation) instructions.push(initObligation(d, user))
  if (d.collateral.farmCollateral && !existing.collateralFarm) instructions.push(initObligationFarm(d, user, d.collateral, 0))
  if (d.debt.farmDebt && !existing.debtFarm) instructions.push(initObligationFarm(d, user, d.debt, 1))
  instructions.push(openLine(d, user, collateral, borrow))
  if (collateral > 0n) instructions.push(closeTokenAccount(ataAddress(user, SOL_MINT), user))
  return instructions
}

export function repayLineInstructions(d: Deployment, user: PublicKey, repay: bigint, withdrawCtokens: bigint): TransactionInstruction[] {
  const instructions = [...computeBudget(1_000_000, 50_000)]
  if (withdrawCtokens > 0n) instructions.push(createAtaIdempotent(user, user, SOL_MINT))
  instructions.push(createAtaIdempotent(user, user, d.debt.mint, d.debt.tokenProgram))
  instructions.push(repayLine(d, user, repay, withdrawCtokens))
  if (withdrawCtokens > 0n) instructions.push(closeTokenAccount(ataAddress(user, SOL_MINT), user))
  return instructions
}

export async function confirmSignature(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<void> {
  let landed = false
  for (let attempt = 0; attempt < 120; attempt++) {
    const [status] = (await connection.getSignatureStatuses([signature])).value
    if (status?.err) throw new Error(`transaction failed on chain: ${signature}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    landed ||= status !== null
    if (!landed && (await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error(`transaction expired before it landed: ${signature}`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`transaction not confirmed in time: ${signature}`)
}
