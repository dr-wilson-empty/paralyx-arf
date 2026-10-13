import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ATA_PROGRAM, FARMS_PROGRAM, KLEND_PROGRAM, Keypair, SOL_MINT, TOKEN_PROGRAM, ataAddress, openLineInstructions, repayLineInstructions } from '../web/src/lib/cli.ts'

const key = () => Keypair.generate().publicKey.toBase58()
const market = key()
const oracles = { pyth: null, switchboardPrice: null, switchboardTwap: null, scope: null }
const reserve = (mint) => ({ address: key(), market, mint, decimals: 6, supply: key(), feeVault: key(), tokenProgram: TOKEN_PROGRAM, ctokenMint: key(), ctokenSupply: key(), farmCollateral: null, farmDebt: null, oracles, status: 0, loanToValuePct: 70, liquidationThresholdPct: 80, symbol: 'X' })
const d = { program: key(), klend: KLEND_PROGRAM, farms: FARMS_PROGRAM, market, collateral: reserve(SOL_MINT), debt: reserve(key()) }
const existing = { metadata: true, obligation: true, collateralFarm: true, debtFarm: true }
const user = Keypair.generate().publicKey
const wrapped = ataAddress(user, SOL_MINT).toBase58()

function wrappedLifecycle(instructions) {
  const program = instructions.findIndex((ix) => ix.programId.toBase58() === d.program)
  const created = instructions.findIndex((ix) => ix.programId.toBase58() === ATA_PROGRAM && ix.keys[1].pubkey.toBase58() === wrapped)
  const closed = instructions.findIndex((ix) => ix.programId.toBase58() === TOKEN_PROGRAM && ix.data[0] === 9 && ix.keys[0].pubkey.toBase58() === wrapped)
  return { program, created, closed }
}

for (const [name, build] of [
  ['open_line with collateral', () => openLineInstructions(d, user, 1_000_000_000n, 1_000_000n, existing)],
  ['open_line that only borrows', () => openLineInstructions(d, user, 0n, 1_000_000n, existing)],
  ['repay_line that withdraws', () => repayLineInstructions(d, user, 1_000_000n, 5n)],
  ['repay_line that only repays', () => repayLineInstructions(d, user, 1_000_000n, 0n)],
]) {
  test(`${name} creates the wrapped SOL account before the program and closes it after`, () => {
    const { program, created, closed } = wrappedLifecycle(build())
    assert.ok(program > 0)
    assert.ok(created >= 0 && created < program, 'created before')
    assert.ok(closed > program, 'closed after')
  })
}
