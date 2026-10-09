import { U64_MAX, connect, deployment, events, explorer, loadKeypair, lookupTables, network, repayLineInstructions, send, show } from './lib.mjs'

const [keypairPath, usdc = '0', ctokens = '0'] = process.argv.slice(2)
if (!keypairPath) throw new Error('usage: node repay.mjs <keypair.json> <usdc|max> <collateral ctokens|max>')
const net = network()
const connection = connect(net)
const user = loadKeypair(keypairPath)
const d = await deployment(connection, net)
const repay = usdc === 'max' ? U64_MAX : BigInt(Math.round(Number(usdc) * 10 ** d.debt.decimals))
const withdraw = ctokens === 'max' ? U64_MAX : BigInt(ctokens)
const signature = await send(connection, user, repayLineInstructions(d, user.publicKey, repay, withdraw), await lookupTables(connection, net))
console.log('repay_line', explorer(net, signature))
for (const event of await events(connection, net, signature)) console.log(show(event))
