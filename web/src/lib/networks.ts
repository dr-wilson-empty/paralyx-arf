export type NetworkId = 'devnet' | 'mainnet'

export type RailId = 'sandbox' | 'bilira'

export interface Network {
  id: NetworkId
  label: string
  rpcUrl: string
  explorerCluster: string
  program: string
  market: string
  marketName: string
  collateralReserve: string
  debtReserve: string
  usdcMint: string
  lookupTable: string | null
  pythSolUsd: string
  rail: RailId
  faucet: boolean
}

export const NETWORK_DATA: Record<NetworkId, Network> = {
  devnet: {
    id: 'devnet',
    label: 'Devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    explorerCluster: '?cluster=devnet',
    program: 'PLXama5SomfMXpUzgwAVhDXMJrESMX8JP93RGRyG6qr',
    market: '4GiGCkrwHphwrsG8imKSHhjTtmbjorqYrYwMsRtBu77Z',
    marketName: 'Kamino Lend · devnet SOL/USDC',
    collateralReserve: '4yh877FXQrfGWLvvEV2QXNUQh4gBN4Q7gcM7Fz4uAnUs',
    debtReserve: 'DJ8gPwXaEX2T8ZJGwZNJc9vL6iwrUUyUrwzeSgjD8RHH',
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    lookupTable: '65qPaimB5uhZ1TADzMY2wwvgqnZbBoNdFQsYcBTFEzLK',
    pythSolUsd: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
    rail: 'sandbox',
    faucet: true,
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    rpcUrl: 'https://solana-rpc.publicnode.com',
    explorerCluster: '',
    program: '',
    market: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
    marketName: 'Kamino Lend · Main Market',
    collateralReserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
    debtReserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    lookupTable: null,
    pythSolUsd: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
    rail: 'bilira',
    faucet: false,
  },
}
