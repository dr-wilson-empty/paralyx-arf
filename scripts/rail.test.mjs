import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Keypair, PublicKey } from '../web/src/lib/cli.ts'
import { requireRepayment } from '../web/api/rail.ts'

const KLEND = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD')
const market = Keypair.generate().publicKey
const debtReserve = Keypair.generate().publicKey
const owner = Keypair.generate().publicKey
const USDC = 1_000_000n

function obligation(reserve, units, programOwner = KLEND) {
  const data = Buffer.alloc(3344)
  data.set(reserve.toBytes(), 1208)
  const scaled = units << 60n
  data.writeBigUInt64LE(scaled & 0xffffffffffffffffn, 1296)
  data.writeBigUInt64LE(scaled >> 64n, 1304)
  return { owner: programOwner, data }
}

function rail({ account = null, wallet = 0n }) {
  return {
    market,
    debtReserve,
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    connection: {
      getAccountInfo: async () => account,
      getTokenAccountBalance: async () => ({ value: { amount: wallet.toString() } }),
    },
  }
}

test('settles a lira repayment up to the open Kamino debt', async () => {
  await requireRepayment(rail({ account: obligation(debtReserve, 10n * USDC), wallet: 6n * USDC }), owner, 10_050_000n)
})

test('refuses wallets without USDC debt on Kamino', async () => {
  await assert.rejects(requireRepayment(rail({}), owner, USDC), /no USDC debt/)
  await assert.rejects(requireRepayment(rail({ account: obligation(Keypair.generate().publicKey, 10n * USDC) }), owner, USDC), /no USDC debt/)
  await assert.rejects(requireRepayment(rail({ account: obligation(debtReserve, 10n * USDC, Keypair.generate().publicKey) }), owner, USDC), /no USDC debt/)
})

test('refuses deposits larger than the debt and wallets that can already repay', async () => {
  await assert.rejects(requireRepayment(rail({ account: obligation(debtReserve, 10n * USDC) }), owner, 12n * USDC), /larger than the open Kamino debt/)
  await assert.rejects(requireRepayment(rail({ account: obligation(debtReserve, 10n * USDC), wallet: 10n * USDC }), owner, USDC), /already holds enough USDC/)
})

test('lets a small debt clear the 50 TRY minimum', async () => {
  await requireRepayment(rail({ account: obligation(debtReserve, 200_000n) }), owner, 1_050_000n)
})
