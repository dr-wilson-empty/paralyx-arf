import { PublicKey, ataAddress, connect, createAtaIdempotent, deployment, explorer, loadKeypair, lookupTables, memo, network, recordPayout, send, transferChecked } from './lib.mjs'

const [keypairPath, usdc = '1', rail = process.env.PARALYX_RAIL ?? 'http://localhost:4173/api/rail'] = process.argv.slice(2)
if (!keypairPath) throw new Error('usage: node cashout.mjs <keypair.json> <usdc> [rail url]')
const net = network()
const connection = connect(net)
const user = loadKeypair(keypairPath)
const d = await deployment(connection, net)

async function call(action, body) {
  const response = await fetch(`${rail}?action=${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? `rail ${response.status}`)
  return result
}

const instruction = await call('payout', { account: user.publicKey.toBase58(), usdc: Number(usdc) })
console.log('payout instruction', instruction.id, 'to', instruction.treasury, 'quote', instruction.tryAmount.toFixed(2), 'TRY')
const units = BigInt(Math.round(Number(usdc) * 10 ** d.debt.decimals))
const treasury = new PublicKey(instruction.treasury)
const payment = await send(connection, user, [
  createAtaIdempotent(user.publicKey, treasury, d.debt.mint),
  transferChecked(ataAddress(user.publicKey, d.debt.mint), d.debt.mint, ataAddress(treasury, d.debt.mint), user.publicKey, units, d.debt.decimals),
  memo(instruction.memo, user.publicKey),
])
console.log('paid the rail', explorer(net, payment))
const settled = await call('confirm', { token: instruction.token, signature: payment })
console.log('sandbox settlement', settled.externalTransactionId, settled.amountOut, 'TRY (simulated, no real lira)')
if (settled.arf?.repaid) console.log('repaid to Arf', settled.arf.repaid, 'USDC for draws', settled.arf.draws.map((draw) => `#${draw.seq}`).join(', '), explorer(net, settled.arf.signature))
if (settled.arf?.error) console.log('Arf repayment failed, the payout stands:', settled.arf.error)
const recorded = await send(connection, user, [recordPayout(d, user.publicKey, instruction.id, BigInt(Math.round(settled.amountOut * 100)))], await lookupTables(connection, net))
console.log('record_payout', explorer(net, recorded))
