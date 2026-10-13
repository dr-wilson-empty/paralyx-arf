import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Keypair, PublicKey } from '../web/src/lib/cli.ts'
import { arfAllocate, arfDraw, arfDrawId, arfLedger, arfStatus, arfTerms, drawMemo, fundingOf, owed, readArfEntry, repayMemo } from '../web/api/rail.ts'

const USDC = 1_000_000n
const DAY = 86_400
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const key = () => Keypair.generate().publicKey.toBase58()
const keys = { facility: key(), facilityAta: key(), treasury: key(), treasuryAta: key(), mint: key() }
const terms = { limit: 100n * USDC, termSeconds: 3 * DAY, feeBps: 10 }

function parsed({ signers, transfers = [], memos = [], err = null, blockTime = 1_000 }) {
  return {
    blockTime,
    meta: { err },
    transaction: {
      message: {
        accountKeys: [...signers.map((signer) => ({ pubkey: new PublicKey(signer), signer: true, writable: true })), { pubkey: new PublicKey(key()), signer: false, writable: true }],
        instructions: [
          ...transfers.map((transfer) => ({
            program: 'spl-token',
            programId: TOKEN,
            parsed: {
              type: 'transferChecked',
              info: { source: transfer.source, destination: transfer.destination, authority: transfer.authority, mint: transfer.mint ?? keys.mint, tokenAmount: { amount: String(transfer.amount), decimals: 6 } },
            },
          })),
          ...memos.map((text) => ({ program: 'spl-memo', programId: MEMO, parsed: text })),
        ],
      },
    },
  }
}

function drawTx(id, amount, { fee = 0n, dueAt = 1_000 + 3 * DAY, blockTime = 1_000, signers = [keys.treasury, keys.facility], transfer = {} } = {}) {
  const memo = drawMemo({ id, amount, fee, dueAt, ref: id.replace('ARF-DR-', 'SBX-DP-') })
  return parsed({
    signers,
    blockTime,
    memos: [memo],
    transfers: [{ source: keys.facilityAta, destination: keys.treasuryAta, authority: keys.facility, amount, ...transfer }],
  })
}

function repayTx(parts, { signers = [keys.treasury], amount = parts.reduce((sum, part) => sum + part.amount, 0n) } = {}) {
  return parsed({ signers, memos: [repayMemo(parts)], transfers: [{ source: keys.treasuryAta, destination: keys.facilityAta, authority: keys.treasury, amount }] })
}

function draw(id, amount, options = {}) {
  return readArfEntry(drawTx(id, amount, options), `sig-${id}-${options.blockTime ?? 1_000}`, keys)
}

function repay(parts, signature = `repay-${parts.map((part) => part.id).join('+')}`) {
  return readArfEntry(repayTx(parts), signature, keys)
}

const A = 'ARF-DR-AAAAAAAAAA'
const B = 'ARF-DR-BBBBBBBBBB'
const C = 'ARF-DR-CCCCCCCCCC'

test('reads the facility terms from the environment and refuses terms outside the Arf range', () => {
  assert.deepEqual(arfTerms({}), { limit: 500n * USDC, termSeconds: 3 * DAY, feeBps: 10 })
  assert.deepEqual(arfTerms({ ARF_LIMIT_USDC: '250.5', ARF_TERM_DAYS: '5', ARF_FEE_BPS: '0' }), { limit: 250_500_000n, termSeconds: 5 * DAY, feeBps: 0 })
  assert.match(arfTerms({ ARF_TERM_DAYS: '6' }), /ARF_TERM_DAYS/)
  assert.match(arfTerms({ ARF_TERM_DAYS: '1.5' }), /ARF_TERM_DAYS/)
  assert.match(arfTerms({ ARF_LIMIT_USDC: '0' }), /ARF_LIMIT_USDC/)
  assert.match(arfTerms({ ARF_LIMIT_USDC: 'abc' }), /ARF_LIMIT_USDC/)
  assert.match(arfTerms({ ARF_FEE_BPS: '-1' }), /ARF_FEE_BPS/)
})

test('derives the draw id from the deposit id', () => {
  assert.equal(arfDrawId('SBX-DP-0A1B2C3D4E'), 'ARF-DR-0A1B2C3D4E')
})

test('reads a draw the facility signed and paid to the treasury', () => {
  const entry = draw(A, 7n * USDC, { fee: 7_000n, dueAt: 9_999, blockTime: 1_234 })
  assert.deepEqual(entry, { kind: 'draw', id: A, ref: 'SBX-DP-AAAAAAAAAA', amount: 7n * USDC, fee: 7_000n, drawnAt: 1_234, dueAt: 9_999, signature: `sig-${A}-1234` })
})

test('ignores draws the facility did not sign or did not pay as written', () => {
  assert.equal(draw(A, USDC, { signers: [keys.treasury] }), null)
  assert.equal(draw(A, USDC, { transfer: { amount: USDC - 1n } }), null)
  assert.equal(draw(A, USDC, { transfer: { destination: key() } }), null)
  assert.equal(draw(A, USDC, { transfer: { source: key() } }), null)
  assert.equal(draw(A, USDC, { transfer: { authority: keys.treasury } }), null)
  assert.equal(draw(A, USDC, { transfer: { mint: key() } }), null)
  const failed = drawTx(A, USDC)
  failed.meta.err = { InstructionError: [1, 'Custom'] }
  assert.equal(readArfEntry(failed, 'sig', keys), null)
})

test('reads a repayment the treasury signed and paid back in full', () => {
  assert.deepEqual(repay([{ id: A, amount: 2n * USDC }, { id: B, amount: 500_000n }], 'r1'), {
    kind: 'repay',
    parts: [
      { id: A, amount: 2n * USDC },
      { id: B, amount: 500_000n },
    ],
    signature: 'r1',
  })
  assert.equal(readArfEntry(repayTx([{ id: A, amount: USDC }], { signers: [keys.facility] }), 'r', keys), null)
  assert.equal(readArfEntry(repayTx([{ id: A, amount: USDC }], { amount: USDC - 1n }), 'r', keys), null)
})

test('ignores memos that only look like Arf records', () => {
  for (const memo of [`ARF-DRAW ${A} amount=1 fee=0 due=1`, `ARF-REPAY ${A}`, `ARF-REPAY ${A}:1,`, `ARF-DRAW ${A.toLowerCase()} amount=1 fee=0 due=1 ref=SBX-DP-AAAAAAAAAA`, 'SBX-DP-AAAAAAAAAA']) {
    const tx = parsed({ signers: [keys.treasury, keys.facility], memos: [memo], transfers: [{ source: keys.facilityAta, destination: keys.treasuryAta, authority: keys.facility, amount: 1n }] })
    assert.equal(readArfEntry(tx, 'sig', keys), null, memo)
  }
})

test('builds the ledger: owed amounts, partial repayments, overdue draws and unknown draw ids', () => {
  const entries = [
    repay([{ id: A, amount: 3n * USDC }, { id: C, amount: USDC }], 'r1'),
    draw(B, 4n * USDC, { fee: 4_000n, dueAt: 500, blockTime: 200 }),
    draw(A, 10n * USDC, { fee: 10_000n, dueAt: 5_000, blockTime: 100 }),
  ]
  const ledger = arfLedger(entries, 1_000)
  assert.deepEqual(
    ledger.draws.map((entry) => [entry.id, entry.amount, entry.fee, entry.repaid, owed(entry), arfStatus(entry, 1_000), entry.repayments]),
    [
      [B, 4n * USDC, 4_000n, 0n, 4_004_000n, 'overdue', []],
      [A, 10n * USDC, 10_000n, 3n * USDC, 7_010_000n, 'open', ['r1']],
    ],
  )
  assert.equal(ledger.outstanding, 11_014_000n)
  assert.equal(ledger.drawn, 14n * USDC)
  assert.equal(ledger.fees, 14_000n)
  assert.equal(ledger.repaid, 3n * USDC)
  assert.equal(ledger.overdue, 1)
  assert.equal(ledger.unmatched, USDC)
})

test('a fully repaid draw owes nothing and is never overdue', () => {
  const ledger = arfLedger([draw(A, 2n * USDC, { fee: 2_000n, dueAt: 10 }), repay([{ id: A, amount: 2_002_000n }])], 1_000)
  assert.equal(owed(ledger.draws[0]), 0n)
  assert.equal(arfStatus(ledger.draws[0], 1_000), 'repaid')
  assert.equal(ledger.overdue, 0)
  assert.equal(ledger.outstanding, 0n)
})

test('counts a draw that landed twice for one deposit as both transfers', () => {
  const ledger = arfLedger([draw(A, USDC, { blockTime: 300, dueAt: 900 }), draw(A, USDC, { blockTime: 100, dueAt: 700 })], 0)
  assert.equal(ledger.draws.length, 1)
  assert.equal(ledger.draws[0].amount, 2n * USDC)
  assert.equal(ledger.draws[0].drawnAt, 100)
  assert.equal(ledger.draws[0].dueAt, 700)
})

test('draws while the line has room, with the fee rounded up and the term from now', () => {
  const ledger = arfLedger([draw(A, 50n * USDC, { dueAt: 10_000 })], 1_000)
  assert.deepEqual(arfDraw(ledger, terms, 49n * USDC, 49n * USDC, 1_000), { fee: 49_000n, dueAt: 1_000 + 3 * DAY })
  assert.deepEqual(arfDraw(arfLedger([], 0), terms, 1n, 1n, 0), { fee: 1n, dueAt: 3 * DAY })
  assert.deepEqual(arfDraw(arfLedger([], 0), { ...terms, feeBps: 0 }, USDC, USDC, 0), { fee: 0n, dueAt: 3 * DAY })
})

test('refuses a draw past the limit, with an overdue draw open, or beyond the facility balance', () => {
  const ledger = arfLedger([draw(A, 50n * USDC, { dueAt: 10_000 })], 1_000)
  assert.deepEqual(arfDraw(ledger, terms, 50n * USDC, 100n * USDC, 1_000), { refused: 'limit' })
  assert.deepEqual(arfDraw(arfLedger([draw(A, USDC, { dueAt: 999 })], 1_000), terms, USDC, 100n * USDC, 1_000), { refused: 'overdue' })
  assert.deepEqual(arfDraw(ledger, terms, 10n * USDC, 10n * USDC - 1n, 1_000), { refused: 'liquidity' })
})

test('repays the earliest due draws first, splits the last one and caps the parts per transaction', () => {
  const ledger = arfLedger([draw(A, 5n * USDC, { dueAt: 3_000 }), draw(B, 5n * USDC, { dueAt: 1_000 }), draw(C, 5n * USDC, { dueAt: 2_000 }), repay([{ id: C, amount: 5n * USDC }])], 0)
  assert.deepEqual(arfAllocate(ledger, 7n * USDC), [
    { id: B, amount: 5n * USDC },
    { id: A, amount: 2n * USDC },
  ])
  assert.deepEqual(arfAllocate(ledger, 0n), [])
  assert.deepEqual(arfAllocate(arfLedger([], 0), 10n * USDC), [])
  const many = arfLedger(
    Array.from({ length: 10 }, (_, index) => draw(`ARF-DR-${String(index).padStart(10, '0')}`, USDC, { dueAt: 1_000 + index })),
    0,
  )
  const parts = arfAllocate(many, 100n * USDC)
  assert.equal(parts.length, 8)
  assert.equal(parts[0].id, 'ARF-DR-0000000000')
})

test('tells an Arf-funded settlement from a treasury one by the memo the RPC returns', () => {
  const memo = `[95] ${drawMemo({ id: A, amount: 5n * USDC, fee: 5_000n, dueAt: 1_700_000_000, ref: 'SBX-DP-AAAAAAAAAA' })}`
  assert.deepEqual(fundingOf(memo), { source: 'arf', drawId: A, fee: 0.005, dueAt: 1_700_000_000 })
  assert.deepEqual(fundingOf('[17] SBX-DP-AAAAAAAAAA'), { source: 'treasury' })
})
