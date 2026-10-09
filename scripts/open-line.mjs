import { PublicKey, connect, deployment, events, explorer, loadKeypair, lookupTables, network, openLineInstructions, send, setupAddresses, show } from './lib.mjs'

const [keypairPath, sol = '0', usdc = '0'] = process.argv.slice(2)
if (!keypairPath) throw new Error('usage: node open-line.mjs <keypair.json> <sol> <usdc>')
const net = network()
const connection = connect(net)
const user = loadKeypair(keypairPath)
const d = await deployment(connection, net)
const toUnits = (value, decimals) => BigInt(Math.round(Number(value) * 10 ** decimals))
const [metadata, obligation, collateralFarm, debtFarm] = await connection.getMultipleAccountsInfo(setupAddresses(d, user.publicKey))
const instructions = openLineInstructions(d, user.publicKey, toUnits(sol, 9), toUnits(usdc, d.debt.decimals), {
  metadata: Boolean(metadata),
  obligation: Boolean(obligation),
  collateralFarm: Boolean(collateralFarm),
  debtFarm: Boolean(debtFarm),
})
const signature = await send(connection, user, instructions, await lookupTables(connection, net))
console.log('open_line', explorer(net, signature))
for (const event of await events(connection, net, signature)) console.log(show(event))
console.log('user', new PublicKey(user.publicKey).toBase58())
