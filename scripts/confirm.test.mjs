import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmSignature } from '../web/src/lib/cli.ts'

function rpc({ statuses, history = null, blockHeight = 100, failures = 0 }) {
  let call = 0
  return {
    getSignatureStatuses: async (_signatures, options) => {
      if (options?.searchTransactionHistory) return { value: [history] }
      if (failures > 0) {
        failures -= 1
        throw new Error('502 Bad Gateway')
      }
      return { value: [statuses[Math.min(call++, statuses.length - 1)]] }
    },
    getBlockHeight: async () => blockHeight,
  }
}

const confirmed = { confirmationStatus: 'confirmed', err: null }

test('resolves once the signature is confirmed, with no websocket', async () => {
  await confirmSignature(rpc({ statuses: [null, confirmed] }), 'sig', 150)
})

test('rejects a transaction that failed on chain', async () => {
  await assert.rejects(confirmSignature(rpc({ statuses: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }] }), 'sig', 150), /failed on chain/)
})

test('rejects when the blockhash expires before the transaction lands', async () => {
  await assert.rejects(confirmSignature(rpc({ statuses: [null], blockHeight: 151 }), 'sig', 150), /expired/)
})

test('keeps waiting for a landed transaction after its blockhash expires', async () => {
  await confirmSignature(rpc({ statuses: [{ confirmationStatus: 'processed', err: null }, confirmed], blockHeight: 151 }), 'sig', 150)
})

test('keeps polling through a transient RPC failure instead of reporting a landed transaction as failed', async () => {
  await confirmSignature(rpc({ statuses: [confirmed], failures: 1 }), 'sig', 150)
})

test('finds a finalized transaction in history once it left the status cache', async () => {
  await confirmSignature(rpc({ statuses: [null], history: { confirmationStatus: 'finalized', err: null }, blockHeight: 151 }), 'sig', 150)
})
