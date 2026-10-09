import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Keypair, PublicKey, bs58, eventsFromTransaction } from '../web/src/lib/cli.ts'

const program = 'PLXama5SomfMXpUzgwAVhDXMJrESMX8JP93RGRyG6qr'
const user = Keypair.generate().publicKey

function openedEvent(collateral, borrow) {
  const data = Buffer.alloc(64)
  data.set([228, 69, 165, 46, 81, 203, 154, 29], 0)
  data.set([200, 206, 237, 128, 16, 167, 83, 72], 8)
  data.set(user.toBytes(), 16)
  data.writeBigUInt64LE(collateral, 48)
  data.writeBigUInt64LE(borrow, 56)
  return bs58.encode(data)
}

function transaction(signature, slot, data, programId = program, err = null) {
  return {
    slot,
    blockTime: 1_791_560_000 + slot,
    transaction: { signatures: [signature] },
    meta: { err, innerInstructions: [{ index: 0, instructions: [{ programId: new PublicKey(programId), accounts: [], data }] }] },
  }
}

test('each event keeps its own signature and slot when the RPC batch comes back out of order', () => {
  const batch = [transaction('second', 20, openedEvent(2n, 20n)), transaction('first', 10, openedEvent(1n, 10n))]
  const events = batch.flatMap((entry) => eventsFromTransaction(entry, program))
  assert.deepEqual(
    events.map(({ signature, slot, a, b }) => ({ signature, slot, a, b })),
    [
      { signature: 'second', slot: 20, a: 2n, b: 20n },
      { signature: 'first', slot: 10, a: 1n, b: 10n },
    ],
  )
  assert.equal(events[0].user, user.toBase58())
  assert.equal(events[0].blockTime, 1_791_560_020)
})

test('ignores failed transactions and other programs', () => {
  assert.deepEqual(eventsFromTransaction(transaction('failed', 30, openedEvent(1n, 1n), program, { InstructionError: [0, 'Custom'] }), program), [])
  assert.deepEqual(eventsFromTransaction(transaction('other', 31, openedEvent(1n, 1n), '11111111111111111111111111111111'), program), [])
  assert.deepEqual(eventsFromTransaction(null, program), [])
})
