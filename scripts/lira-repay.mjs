import { connect, deployment, events, explorer, loadKeypair, lookupTables, network, repayLineInstructions, send, show } from './lib.mjs'

const [keypairPath, tryAmount = '100', rail = process.env.PARALYX_RAIL ?? 'http://localhost:4173/api/rail'] = process.argv.slice(2)
if (!keypairPath) throw new Error('usage: node lira-repay.mjs <keypair.json> <try> [rail url]')
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

const deposit = await call('deposit', { account: user.publicKey.toBase58(), tryAmount: Number(tryAmount) })
console.log('deposit instruction', deposit.id, 'for', deposit.usdc.toFixed(6), 'USDC', deposit.iban)
const settled = await call('settle', { token: deposit.token })
const funding = settled.funding?.source === 'arf' ? `Arf draw ${settled.funding.drawId}, fee ${settled.funding.fee} USDC, due ${new Date(settled.funding.dueAt * 1000).toISOString()}` : `rail treasury${settled.funding?.reason ? `, Arf refused: ${settled.funding.reason}` : ''}`
console.log('sandbox settlement', settled.amountOut, 'USDC from', funding, explorer(net, settled.signature))
const units = BigInt(Math.floor(settled.amountOut * 0.999 * 10 ** d.debt.decimals))
const signature = await send(connection, user, repayLineInstructions(d, user.publicKey, units, 0n), await lookupTables(connection, net))
console.log('repay_line', explorer(net, signature))
for (const event of await events(connection, net, signature)) console.log(show(event))
