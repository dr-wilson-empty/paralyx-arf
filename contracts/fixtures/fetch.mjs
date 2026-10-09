import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'mainnet')
const rpc = process.env.FIXTURE_RPC ?? 'https://api.mainnet-beta.solana.com'
const refresh = process.argv.includes('--refresh')
const spec = JSON.parse(readFileSync(join(here, 'mainnet.json'), 'utf8'))

async function call(method, params) {
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (!response.ok) throw new Error(`${method} ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(`${method} ${JSON.stringify(body.error)}`)
  return body.result
}

async function dumpProgram(programId, file) {
  const program = await call('getAccountInfo', [programId, { encoding: 'base64' }])
  const programData = Buffer.from(program.value.data[0], 'base64')
  const dataAddress = encode(programData.subarray(4, 36))
  const data = await call('getAccountInfo', [dataAddress, { encoding: 'base64' }])
  const padded = Buffer.from(data.value.data[0], 'base64').subarray(45)
  const elf = padded.subarray(0, Number(padded.readBigUInt64LE(0x28)) + padded.readUInt16LE(0x3a) * padded.readUInt16LE(0x3c))
  writeFileSync(join(out, file), elf)
  return { programId, programData: dataAddress, bytes: elf.length }
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function encode(bytes) {
  let value = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'))
  let text = ''
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    text = '1' + text
  }
  return text
}

if (existsSync(join(out, 'snapshot.json')) && !refresh) {
  console.log('fixtures present, pass --refresh to fetch again')
  process.exit(0)
}

mkdirSync(out, { recursive: true })
const programs = []
for (const entry of spec.programs) programs.push({ ...(await dumpProgram(entry.address, entry.file)), name: entry.name })
const addresses = spec.accounts.map((entry) => entry.address)
const snapshot = await call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }])
const missing = addresses.filter((_, index) => !snapshot.value[index])
if (missing.length) throw new Error(`missing accounts: ${missing.join(', ')}`)
const accounts = spec.accounts.map((entry, index) => {
  const account = snapshot.value[index]
  return { name: entry.name, address: entry.address, lamports: account.lamports, owner: account.owner, executable: account.executable, data: account.data[0] }
})
const unixTimestamp = Math.floor(Date.now() / 1000)
writeFileSync(join(out, 'snapshot.json'), JSON.stringify({ rpc, slot: snapshot.context.slot, unixTimestamp, programs, accounts }, null, 1))
console.log(`fixtures written at slot ${snapshot.context.slot}: ${accounts.length} accounts, ${programs.map((p) => `${p.name} ${p.bytes} bytes`).join(', ')}`)
