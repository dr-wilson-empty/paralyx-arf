export type TokenSymbol = 'USDC' | 'SOL' | 'TRY' | 'ETH' | 'BTC'

const sources: Record<TokenSymbol, string> = {
  USDC: '/tokens/usdc.svg',
  SOL: '/tokens/sol.svg',
  TRY: '/tokens/tr.svg',
  ETH: '/tokens/eth.svg',
  BTC: '/tokens/btc.svg',
}

export const tokenNames: Record<TokenSymbol, string> = {
  USDC: 'USD Coin',
  SOL: 'Solana',
  TRY: 'Türk lirası',
  ETH: 'Ether',
  BTC: 'Bitcoin',
}

export function asTokenSymbol(symbol: string): TokenSymbol | null {
  const upper = symbol.toUpperCase()
  if (upper === 'WSOL') return 'SOL'
  return upper in sources ? (upper as TokenSymbol) : null
}

export function TokenIcon({ symbol, size = 24, className = '' }: { symbol: TokenSymbol | string; size?: number; className?: string }) {
  const known = asTokenSymbol(symbol)
  if (!known) {
    return (
      <span
        className={'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-soft text-ink ' + className}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.34) }}
      >
        {symbol.slice(0, 3)}
      </span>
    )
  }
  const mark = known === 'SOL'
  return (
    <span
      className={'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line ' + (mark ? 'bg-black ' : 'bg-surface ') + className}
      style={{ width: size, height: size }}
    >
      <img
        src={sources[known]}
        alt={known}
        draggable={false}
        className={mark ? 'h-[56%] w-[56%] object-contain' : 'h-full w-full object-cover'}
        style={known === 'TRY' ? { objectPosition: '38% 50%' } : undefined}
      />
    </span>
  )
}

export function TokenLabel({ symbol, size = 20, className = '' }: { symbol: TokenSymbol; size?: number; className?: string }) {
  return (
    <span className={'inline-flex items-center gap-2 ' + className}>
      <TokenIcon symbol={symbol} size={size} />
      <span>{symbol === 'TRY' ? '₺ TRY' : symbol}</span>
    </span>
  )
}

export function KaminoMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={'inline-flex shrink-0 ' + className} style={{ height: size }}>
      <img src="/brand/kamino-mark.svg" alt="Kamino" draggable={false} className="h-full w-auto dark:hidden" />
      <img src="/brand/kamino-mark-white.svg" alt="Kamino" draggable={false} className="hidden h-full w-auto dark:block" />
    </span>
  )
}

export function KaminoWordmark({ height = 14, className = '' }: { height?: number; className?: string }) {
  return (
    <span className={'inline-flex shrink-0 ' + className} style={{ height }}>
      <img src="/brand/kamino-wordmark.svg" alt="Kamino" draggable={false} className="h-full w-auto dark:hidden" />
      <img src="/brand/kamino-wordmark-white.svg" alt="Kamino" draggable={false} className="hidden h-full w-auto dark:block" />
    </span>
  )
}
