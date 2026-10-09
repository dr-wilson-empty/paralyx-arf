import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmSignature } from '../web/src/lib/cli.ts'

function rpc(statuses, blockHeight = 100) {
  let call = 0
  return {
    getSignatureStatuses: async () => ({ value: [statuses[Math.min(call++, statuses.length - 1)]] }),
    getBlockHeight: async () => blockHeight,
  }
}

test('resolves once the signature is confirmed, with no websocket', async () => {
  await confirmSignature(rpc([null, { confirmationStatus: 'confirmed', err: null }]), 'sig', 150)
})

test('rejects a transaction that failed on chain', async () => {
  await assert.rejects(confirmSignature(rpc([{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }]), 'sig', 150), /failed on chain/)
})

test('rejects when the blockhash expires before the transaction lands', async () => {
  await assert.rejects(confirmSignature(rpc([null], 151), 'sig', 150), /expired/)
})

test('keeps waiting for a landed transaction after its blockhash expires', async () => {
  await confirmSignature(rpc([{ confirmationStatus: 'processed', err: null }, { confirmationStatus: 'confirmed', err: null }], 151), 'sig', 150)
})
