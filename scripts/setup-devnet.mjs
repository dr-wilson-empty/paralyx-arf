import {
  AddressLookupTableProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  configAddress,
  connect,
  createAtaIdempotent,
  decodeConfig,
  deployment,
  explorer,
  initialize,
  loadKeypair,
  network,
  send,
  staticAddresses,
} from './lib.mjs'

const [deployerPath = '../.keys/deployer.json', treasuryPath = '../.keys/treasury.json'] = process.argv.slice(2)
const net = network('devnet')
const connection = connect(net)
const deployer = loadKeypair(deployerPath)
const treasury = loadKeypair(treasuryPath)
const d = await deployment(connection, net)

const program = await connection.getAccountInfo(new PublicKey(net.program))
if (!program?.executable) throw new Error(`program ${net.program} is not deployed on devnet`)

const config = await connection.getAccountInfo(configAddress(net.program))
if (config) {
  console.log('config exists', decodeConfig(config.data))
} else {
  const signature = await send(connection, deployer, [initialize(d, deployer.publicKey)])
  console.log('initialized config', explorer(net, signature))
}

if (!net.lookupTable || process.argv.includes('--new-lut')) {
  const recentSlot = await connection.getSlot('finalized')
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: deployer.publicKey, payer: deployer.publicKey, recentSlot })
  const addresses = staticAddresses(d).map((value) => new PublicKey(value))
  await send(connection, deployer, [create])
  for (let index = 0; index < addresses.length; index += 25) {
    await send(connection, deployer, [AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: deployer.publicKey, payer: deployer.publicKey, addresses: addresses.slice(index, index + 25) })])
  }
  console.log(`lookup table ${table.toBase58()} with ${addresses.length} addresses; set lookupTable in web/src/lib/networks.ts`)
}

const treasuryBalance = await connection.getBalance(treasury.publicKey)
const instructions = [createAtaIdempotent(deployer.publicKey, treasury.publicKey, net.usdcMint)]
if (treasuryBalance < 0.05 * LAMPORTS_PER_SOL) instructions.push(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: treasury.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }))
const signature = await send(connection, deployer, instructions)
console.log('sandbox treasury', treasury.publicKey.toBase58(), 'ready', explorer(net, signature))
