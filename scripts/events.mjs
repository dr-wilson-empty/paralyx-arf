import { PublicKey, connect, events, network, show } from './lib.mjs'

const net = network(process.argv[2])
if (!net.program) throw new Error(`no Paralyx program on ${net.id}`)
const connection = connect(net)
const signatures = await connection.getSignaturesForAddress(new PublicKey(net.program), { limit: Number(process.argv[3] ?? 50) })
for (const entry of signatures.filter((item) => !item.err).reverse()) {
  for (const event of await events(connection, net, entry.signature)) console.log(show(event))
}
