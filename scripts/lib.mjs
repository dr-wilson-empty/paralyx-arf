import { readFileSync } from 'node:fs'
import {
  Connection,
  FARMS_PROGRAM,
  KLEND_PROGRAM,
  Keypair,
  NETWORK_DATA,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  confirmSignature,
  decodeReserve,
  eventsFromTransaction,
} from '../web/src/lib/cli.ts'

export * from '../web/src/lib/cli.ts'

export function network(name = process.env.PARALYX_NETWORK ?? 'devnet') {
  const data = NETWORK_DATA[name]
  if (!data) throw new Error(`unknown network ${name}`)
  return { ...data, rpcUrl: process.env.PARALYX_RPC ?? data.rpcUrl }
}

export function connect(net) {
  return new Connection(net.rpcUrl, 'confirmed')
}

export function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

export async function deployment(connection, net) {
  const [collateral, debt] = await connection.getMultipleAccountsInfo([new PublicKey(net.collateralReserve), new PublicKey(net.debtReserve)])
  if (!collateral || !debt) throw new Error('Kamino reserves not found')
  return {
    program: net.program,
    klend: KLEND_PROGRAM,
    farms: FARMS_PROGRAM,
    market: net.market,
    collateral: decodeReserve(net.collateralReserve, collateral.data),
    debt: decodeReserve(net.debtReserve, debt.data),
  }
}

export async function lookupTables(connection, net) {
  if (!net.lookupTable) return []
  const result = await connection.getAddressLookupTable(new PublicKey(net.lookupTable))
  return result.value ? [result.value] : []
}

export async function send(connection, payer, instructions, tables = [], signers = []) {
  const latest = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: latest.blockhash, instructions }).compileToV0Message(tables)
  const transaction = new VersionedTransaction(message)
  transaction.sign([payer, ...signers])
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 5 })
  await confirmSignature(connection, signature, latest.lastValidBlockHeight)
  return signature
}

export async function events(connection, net, signature) {
  const transaction = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
  return eventsFromTransaction(transaction, net.program)
}

export function explorer(net, signature) {
  return `https://explorer.solana.com/tx/${signature}${net.explorerCluster}`
}

export function show(event) {
  const amounts = { ...event, a: event.a.toString(), b: event.b.toString() }
  return JSON.stringify(amounts)
}
