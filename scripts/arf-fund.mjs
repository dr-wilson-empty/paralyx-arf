import { PublicKey, ataAddress, connect, createAtaIdempotent, deployment, explorer, loadKeypair, network, send, transferChecked } from './lib.mjs'

const [keypairPath, facility, usdc] = process.argv.slice(2)
if (!keypairPath || !facility || !usdc) throw new Error('usage: node arf-fund.mjs <payer keypair.json> <facility address> <usdc>')
const net = network()
const connection = connect(net)
const payer = loadKeypair(keypairPath)
const d = await deployment(connection, net)
const owner = new PublicKey(facility)
const units = BigInt(Math.round(Number(usdc) * 10 ** d.debt.decimals))
const signature = await send(connection, payer, [
  createAtaIdempotent(payer.publicKey, owner, d.debt.mint),
  transferChecked(ataAddress(payer.publicKey, d.debt.mint), d.debt.mint, ataAddress(owner, d.debt.mint), payer.publicKey, units, d.debt.decimals),
])
console.log('Arf sandbox line', owner.toBase58(), 'funded with', usdc, 'devnet USDC', explorer(net, signature))
