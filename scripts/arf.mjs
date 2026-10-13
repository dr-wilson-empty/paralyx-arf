import { PublicKey, ataAddress, connect, createAtaIdempotent, explorer, loadKeypair, network, send } from './lib.mjs'
import { ARF_PROGRAM, arfCreateLineIx, arfFundIx, arfLineAddress, arfOpenDraws, arfOwed, arfSetTermsIx, arfVaultAddress, arfWithdrawIx, decodeArfLine, readArf } from '../web/api/rail.ts'

const USAGE = `usage:
  node arf.mjs create   <provider.json> <operator address> <limit usdc> <term days> <fee bps>
  node arf.mjs fund     <provider.json> <line address> <usdc>
  node arf.mjs withdraw <provider.json> <line address> <usdc>
  node arf.mjs terms    <provider.json> <line address> <limit usdc> <term days> <fee bps> <open|frozen>
  node arf.mjs show     <line address>`

const [command, ...args] = process.argv.slice(2)
const net = network()
const connection = connect(net)
const program = new PublicKey(process.env.ARF_PROGRAM || ARF_PROGRAM)
const mint = new PublicKey(net.usdcMint)
const usdc = (value) => BigInt(Math.round(Number(value) * 1e6))
const days = (value) => Math.round(Number(value) * 86_400)
const show = (value) => (Number(value) / 1e6).toFixed(6)

async function line(address) {
  const account = await connection.getAccountInfo(new PublicKey(address))
  if (!account) throw new Error(`no account at ${address}`)
  return decodeArfLine(new PublicKey(address), account.data)
}

if (command === 'create') {
  const [providerPath, operator, limit, term, fee] = args
  if (!fee) throw new Error(USAGE)
  const provider = loadKeypair(providerPath)
  const operatorKey = new PublicKey(operator)
  const address = arfLineAddress(program, provider.publicKey, operatorKey, mint)
  const signature = await send(connection, provider, [arfCreateLineIx(program, provider.publicKey, operatorKey, mint, usdc(limit), days(term), Number(fee))])
  console.log('line', address.toBase58(), 'vault', arfVaultAddress(program, address).toBase58(), explorer(net, signature))
  console.log(`set ARF_LINE=${address.toBase58()} for the rail`)
} else if (command === 'fund' || command === 'withdraw') {
  const [providerPath, address, amount] = args
  if (!amount) throw new Error(USAGE)
  const provider = loadKeypair(providerPath)
  const state = await line(address)
  const own = ataAddress(provider.publicKey, net.usdcMint)
  const instruction = command === 'fund' ? arfFundIx(program, state, provider.publicKey, own, usdc(amount)) : arfWithdrawIx(program, state, provider.publicKey, own, usdc(amount))
  const signature = await send(connection, provider, [createAtaIdempotent(provider.publicKey, provider.publicKey, net.usdcMint), instruction])
  console.log(command, amount, 'USDC', explorer(net, signature))
} else if (command === 'terms') {
  const [providerPath, address, limit, term, fee, state] = args
  if (!['open', 'frozen'].includes(state)) throw new Error(USAGE)
  const provider = loadKeypair(providerPath)
  const signature = await send(connection, provider, [arfSetTermsIx(program, new PublicKey(address), provider.publicKey, usdc(limit), days(term), Number(fee), state === 'frozen')])
  console.log('terms set', explorer(net, signature))
} else if (command === 'show') {
  const [address] = args
  if (!address) throw new Error(USAGE)
  const state = await line(address)
  const { draws, liquidity } = await readArf({ connection, arfProgram: program, usdcMint: net.usdcMint }, state.address, state.operator, true)
  console.log({
    provider: state.provider.toBase58(),
    operator: state.operator.toBase58(),
    vault: state.vault.toBase58(),
    liquidity: show(liquidity),
    limit: show(state.limit),
    termDays: state.termSeconds / 86_400,
    feeBps: state.feeBps,
    frozen: state.frozen,
    outstanding: show(state.outstanding),
    drawn: show(state.drawn),
    fees: show(state.fees),
    repaid: show(state.repaid),
    draws: Number(state.nextSeq),
    head: Number(state.headSeq),
    headDue: state.headDueAt ? new Date(state.headDueAt * 1000).toISOString() : null,
  })
  for (const draw of arfOpenDraws(state, draws)) console.log('open', Number(draw.seq), draw.reference, show(draw.amount), 'owed', show(arfOwed(draw)), 'due', new Date(draw.dueAt * 1000).toISOString())
} else {
  throw new Error(USAGE)
}
