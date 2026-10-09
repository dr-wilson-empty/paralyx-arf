import { NETWORK_DATA, type Network, type NetworkId, type RailId } from './lib/networks'

export type { Network, NetworkId, RailId }

const STORAGE_KEY = 'paralyx.network'

export const NETWORKS: Record<NetworkId, Network> = {
  devnet: { ...NETWORK_DATA.devnet, rpcUrl: import.meta.env.VITE_DEVNET_RPC ?? NETWORK_DATA.devnet.rpcUrl },
  mainnet: { ...NETWORK_DATA.mainnet, rpcUrl: import.meta.env.VITE_MAINNET_RPC ?? NETWORK_DATA.mainnet.rpcUrl },
}

export function currentNetworkId(): NetworkId {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mainnet' ? 'mainnet' : 'devnet'
  } catch {
    return 'devnet'
  }
}

export function switchNetwork(id: NetworkId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    return
  }
  window.location.reload()
}

export const NETWORK: Network = NETWORKS[currentNetworkId()]
export const NETWORK_ID: NetworkId = NETWORK.id
export const IS_MAINNET = NETWORK.id === 'mainnet'
export const PROGRAM_ID = NETWORK.program
export const HAS_SANDBOX_RAIL = NETWORK.rail === 'sandbox'
export const RAIL_API = import.meta.env.VITE_RAIL_API ?? '/api/rail'
export const BURNER_WALLET = import.meta.env.VITE_BURNER_WALLET === '1' && !IS_MAINNET

export function txLink(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${NETWORK.explorerCluster}`
}

export function addressLink(address: string): string {
  return `https://explorer.solana.com/address/${address}${NETWORK.explorerCluster}`
}

export const RAIL_MAX_USDC = 300
export const RAIL_MAX_TRY = 3000
export const RAIL_MIN_USDC = 0.5
export const RAIL_MIN_TRY = 50
export const SOL_DECIMALS = 9
export const USDC_DECIMALS = 6
export const SAFETY_BUFFER = 0.97
export const SOL_FEE_RESERVE = 0.02
export const SHOW_BACKGROUND = true
