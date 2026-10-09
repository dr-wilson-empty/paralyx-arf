import Decimal from 'decimal.js'

export function chunks<T>(array: T[], size: number): T[][] {
  return [...new Array(Math.ceil(array.length / size)).keys()].map((_, index) => array.slice(index * size, (index + 1) * size))
}

export async function batchFetch<T, R>(addresses: T[], fetchBatch: (chunk: T[]) => Promise<R[]>, chunkSize = 100): Promise<R[]> {
  const results = await Promise.all(chunks(addresses, chunkSize).map((chunk) => fetchBatch(chunk)))
  return results.reduce<R[]>((acc, curr) => acc.concat(...curr), [])
}

export function aprToApy(apr: Decimal, compoundPeriods: number): Decimal {
  return new Decimal(1).add(apr.div(compoundPeriods)).pow(compoundPeriods).sub(1)
}

export const DECIMALS_SOL = 9
export const FullBPS = 10_000
export const FullBPSDecimal = new Decimal(FullBPS)
export const ZERO = new Decimal(0)

export function collToLamportsDecimal(amount: Decimal, decimals: number): Decimal {
  return amount.mul(new Decimal(10).pow(decimals))
}
