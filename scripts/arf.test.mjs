import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Keypair, PublicKey } from '../web/src/lib/cli.ts'
import {
  ARF_DISCRIMINATORS,
  arfAllocate,
  arfCreateLineIx,
  arfDrawAddress,
  arfDrawIx,
  arfFee,
  arfLineAddress,
  arfOpenDraws,
  arfOwed,
  arfRefusal,
  arfRepayIx,
  arfSetTermsIx,
  arfStatus,
  arfVaultAddress,
  decodeArfDraw,
  decodeArfLine,
  readArf,
} from '../web/api/rail.ts'

const USDC = 1_000_000n
const DAY = 86_400
const PROGRAM = new PublicKey('ARF4tQPAqQdGScZK7kF2yWK4tpkp99mPpEkr2rtdvAoC')
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const key = () => Keypair.generate().publicKey
const provider = key()
const operator = key()
const mint = key()
const address = arfLineAddress(PROGRAM, provider, operator, mint)
const vault = arfVaultAddress(PROGRAM, address)

function lineState(overrides = {}) {
  return { address, provider, operator, mint, vault, limit: 100n * USDC, termSeconds: 3 * DAY, feeBps: 10, frozen: false, outstanding: 0n, drawn: 0n, fees: 0n, repaid: 0n, nextSeq: 0n, headSeq: 0n, headDueAt: 0, ...overrides }
}

function drawState(seq, amount, overrides = {}) {
  const reference = `SBX-DP-${String(seq).padStart(10, '0')}`
  return { address: arfDrawAddress(PROGRAM, address, reference), line: address, seq: BigInt(seq), destination: key(), amount, fee: 0n, repaid: 0n, drawnAt: 1_000, dueAt: 1_000 + 3 * DAY, reference, ...overrides }
}

function encodeLine(line) {
  const data = Buffer.alloc(278)
  ARF_DISCRIMINATORS.line.copy(data, 0)
  for (const [at, value] of [[8, line.provider], [40, line.operator], [72, line.mint], [104, line.vault]]) value.toBuffer().copy(data, at)
  data.writeBigUInt64LE(line.limit, 136)
  data.writeBigInt64LE(BigInt(line.termSeconds), 144)
  data.writeUInt16LE(line.feeBps, 152)
  data[154] = line.frozen ? 1 : 0
  for (const [at, value] of [[155, line.outstanding], [163, line.drawn], [171, line.fees], [179, line.repaid], [187, line.nextSeq], [195, line.headSeq]]) data.writeBigUInt64LE(value, at)
  data.writeBigInt64LE(BigInt(line.headDueAt), 203)
  return data
}

function encodeDraw(draw) {
  const data = Buffer.alloc(190)
  ARF_DISCRIMINATORS.drawAccount.copy(data, 0)
  draw.line.toBuffer().copy(data, 8)
  data.writeBigUInt64LE(draw.seq, 40)
  draw.destination.toBuffer().copy(data, 48)
  for (const [at, value] of [[80, draw.amount], [88, draw.fee], [96, draw.repaid]]) data.writeBigUInt64LE(value, at)
  data.writeBigInt64LE(BigInt(draw.drawnAt), 104)
  data.writeBigInt64LE(BigInt(draw.dueAt), 112)
  data.writeUInt32LE(Buffer.byteLength(draw.reference), 154)
  data.write(draw.reference, 158, 'utf8')
  return data
}

test('discriminators match the ones the arf_line program was built with', () => {
  const hex = Object.fromEntries(Object.entries(ARF_DISCRIMINATORS).map(([name, bytes]) => [name, Buffer.from(bytes).toString('hex')]))
  assert.deepEqual(hex, {
    createLine: 'fc976a4228116949',
    fund: 'dabc6fdd9871ae07',
    withdraw: 'b712469c946da122',
    setTerms: 'c612c5e2dce657ad',
    draw: '3d283eb81fb01882',
    repay: 'ea674352d0eadba6',
    line: '0f497d99b40d50bb',
    drawAccount: 'e18329de7a1492ca',
  })
})

test('decodes a line and a draw at the offsets of the program accounts', () => {
  const line = lineState({ limit: 500n * USDC, feeBps: 25, frozen: true, outstanding: 7n, drawn: 11n, fees: 2n, repaid: 6n, nextSeq: 4n, headSeq: 3n, headDueAt: 1_800_000_000 })
  assert.deepEqual(decodeArfLine(address, encodeLine(line)), line)
  const draw = drawState(3, 2_015_491n, { fee: 2_016n, repaid: 1n })
  assert.deepEqual(decodeArfDraw(draw.address, encodeDraw(draw)), draw)
  assert.throws(() => decodeArfLine(address, encodeDraw(draw)), /not an Arf line/)
  assert.throws(() => decodeArfDraw(draw.address, encodeLine(line)), /not an Arf draw/)
})

test('rounds the fee up and owes amount plus fee less what was repaid', () => {
  assert.equal(arfFee(2_015_491n, 10), 2_016n)
  assert.equal(arfFee(1n, 10), 1n)
  assert.equal(arfFee(10n * USDC, 0), 0n)
  assert.equal(arfOwed({ amount: 5n, fee: 1n, repaid: 2n }), 4n)
  assert.equal(arfOwed({ amount: 5n, fee: 1n, repaid: 9n }), 0n)
})

test('refuses a draw the program would refuse, in the program order', () => {
  const now = 10_000
  assert.equal(arfRefusal(lineState(), 10n * USDC, 10n * USDC, now), null)
  assert.equal(arfRefusal(lineState({ frozen: true, nextSeq: 1n, headDueAt: 1 }), USDC, USDC, now), 'frozen')
  assert.equal(arfRefusal(lineState({ nextSeq: 1n, headDueAt: now - 1 }), USDC, USDC, now), 'overdue')
  assert.equal(arfRefusal(lineState({ nextSeq: 1n, headDueAt: now }), USDC, USDC, now), null)
  assert.equal(arfRefusal(lineState({ headSeq: 1n, nextSeq: 1n, headDueAt: 0 }), USDC, USDC, now), null)
  assert.equal(arfRefusal(lineState({ outstanding: 90n * USDC }), 10n * USDC, 10n * USDC, now), 'limit')
  assert.equal(arfRefusal(lineState({ outstanding: 90n * USDC, feeBps: 0 }), 10n * USDC, 10n * USDC, now), null)
  assert.equal(arfRefusal(lineState(), 10n * USDC, 10n * USDC - 1n, now), 'liquidity')
})

test('lists open draws from the head and tells repaid, open and overdue apart', () => {
  const line = lineState({ headSeq: 1n, nextSeq: 4n })
  const draws = [drawState(3, USDC), drawState(0, USDC, { repaid: USDC }), drawState(1, USDC, { dueAt: 50 }), drawState(2, USDC)]
  assert.deepEqual(arfOpenDraws(line, draws).map((draw) => draw.seq), [1n, 2n, 3n])
  assert.equal(arfStatus(line, draws[1], 100), 'repaid')
  assert.equal(arfStatus(line, draws[2], 100), 'overdue')
  assert.equal(arfStatus(line, draws[3], 100), 'open')
})

test('repays the oldest draws first, stops inside a draw and names the next open draw', () => {
  const open = [drawState(0, 2n * USDC, { fee: 2_000n }), drawState(1, 3n * USDC, { fee: 3_000n }), drawState(2, 4n * USDC)]
  const partial = arfAllocate(open, 3n * USDC)
  assert.equal(partial.amount, 3n * USDC)
  assert.deepEqual(partial.parts.map((part) => [part.seq, part.amount]), [[0n, 2_002_000n], [1n, 998_000n]])
  assert.deepEqual(partial.accounts, [open[0].address, open[1].address, open[2].address])
  const first = arfAllocate(open, 2_002_000n)
  assert.deepEqual(first.parts.map((part) => part.seq), [0n])
  assert.deepEqual(first.accounts, [open[0].address, open[1].address])
  const all = arfAllocate(open, 100n * USDC)
  assert.equal(all.amount, 9_005_000n)
  assert.deepEqual(all.accounts, open.map((draw) => draw.address))
  assert.deepEqual(arfAllocate(open, 0n), { amount: 0n, accounts: [open[0].address], parts: [] })
  assert.deepEqual(arfAllocate([], 5n * USDC), { amount: 0n, accounts: [], parts: [] })
  const many = Array.from({ length: 10 }, (_, seq) => drawState(seq, USDC))
  const capped = arfAllocate(many, 100n * USDC)
  assert.equal(capped.parts.length, 8)
  assert.equal(capped.accounts.length, 9)
})

test('builds draw, repay, create and terms instructions in the account order of the program', () => {
  const line = lineState()
  const destination = key()
  const draw = arfDrawIx(PROGRAM, line, operator, 'SBX-DP-AAAAAAAAAA', 7n, destination)
  assert.deepEqual(
    draw.keys.map((meta) => [meta.pubkey.toBase58(), meta.isSigner, meta.isWritable]),
    [
      [operator.toBase58(), true, true],
      [address.toBase58(), false, true],
      [arfDrawAddress(PROGRAM, address, 'SBX-DP-AAAAAAAAAA').toBase58(), false, true],
      [mint.toBase58(), false, false],
      [vault.toBase58(), false, true],
      [destination.toBase58(), false, true],
      [TOKEN.toBase58(), false, false],
      ['11111111111111111111111111111111', false, false],
      [PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM)[0].toBase58(), false, false],
      [PROGRAM.toBase58(), false, false],
    ],
  )
  assert.equal(draw.data.toString('hex'), '3d283eb81fb01882' + '11000000' + Buffer.from('SBX-DP-AAAAAAAAAA').toString('hex') + '0700000000000000')

  const source = key()
  const draws = [key(), key()]
  const repay = arfRepayIx(PROGRAM, line, operator, source, 9n, draws)
  assert.deepEqual(repay.keys.slice(0, 6).map((meta) => meta.pubkey.toBase58()), [operator, address, mint, vault, source, TOKEN].map((value) => value.toBase58()))
  assert.deepEqual(repay.keys.slice(8).map((meta) => [meta.pubkey.toBase58(), meta.isWritable]), draws.map((draw) => [draw.toBase58(), true]))
  assert.equal(repay.data.toString('hex'), 'ea674352d0eadba6' + '0900000000000000')

  const create = arfCreateLineIx(PROGRAM, provider, operator, mint, 500n * USDC, 3 * DAY, 10)
  assert.deepEqual(create.keys.slice(3, 5).map((meta) => meta.pubkey.toBase58()), [address.toBase58(), vault.toBase58()])
  assert.equal(create.data.toString('hex'), 'fc976a4228116949' + '0065cd1d00000000' + '80f4030000000000' + '0a00')
  assert.equal(arfSetTermsIx(PROGRAM, address, provider, USDC, DAY, 0, true).data.toString('hex'), 'c612c5e2dce657ad' + '40420f0000000000' + '8051010000000000' + '0000' + '01')
})

test('reads the line, its draws and the vault balance, and refuses a line run by someone else', async () => {
  const line = lineState({ nextSeq: 2n, headSeq: 1n })
  const draws = [drawState(0, USDC, { repaid: USDC }), drawState(1, 2n * USDC)]
  const vaultData = Buffer.alloc(165)
  vaultData.writeBigUInt64LE(42n * USDC, 64)
  let filters = null
  const connection = {
    getMultipleAccountsInfo: async (keys) => {
      assert.deepEqual(keys.map((value) => value.toBase58()), [address.toBase58(), vault.toBase58()])
      return [{ owner: PROGRAM, data: encodeLine(line) }, { owner: TOKEN, data: vaultData }]
    },
    getProgramAccounts: async (_program, options) => {
      filters = options.filters
      return draws.map((draw) => ({ pubkey: draw.address, account: { data: encodeDraw(draw) } }))
    },
  }
  const e = { connection, arfProgram: PROGRAM, usdcMint: mint.toBase58() }
  const read = await readArf(e, address, operator, true)
  assert.equal(read.liquidity, 42n * USDC)
  assert.deepEqual(read.line, line)
  assert.deepEqual(read.draws.map((draw) => draw.seq), [0n, 1n])
  assert.equal(filters[1].memcmp.bytes, address.toBase58())
  await assert.rejects(readArf(e, address, key(), true), /operator is not the sandbox treasury/)
  await assert.rejects(readArf({ ...e, usdcMint: key().toBase58() }, address, operator, false), /another mint/)
  await assert.rejects(readArf({ ...e, connection: { ...connection, getMultipleAccountsInfo: async () => [{ owner: key(), data: encodeLine(line) }, null] } }, address, operator, false), /not an account of the Arf program/)
})
