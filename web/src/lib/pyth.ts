export function decodePythPrice(data: Uint8Array): { price: number; publishTime: number } | null {
  if (data.length < 41) return null
  const offset = data[40] === 1 ? 41 : 42
  if (data.length < offset + 60) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const price = Number(view.getBigInt64(offset + 32, true))
  const exponent = view.getInt32(offset + 48, true)
  const publishTime = Number(view.getBigInt64(offset + 52, true))
  return { price: price * 10 ** exponent, publishTime }
}
