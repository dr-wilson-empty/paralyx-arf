import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoMarket, KaminoObligation, LendingMarket, getCurrentLedgerInstant, getSingleReserve, type KaminoReserve } from '@kamino-finance/klend-sdk'
import { address, createSolanaRpc } from '@solana/kit'
import { NETWORK, SAFETY_BUFFER } from '../config'
import { KLEND_PROGRAM, obligationAddress } from './paralyx'

export type MarketStatus = 'active' | 'paused' | 'emergency'

export interface ReserveRow {
  address: string
  mint: string
  symbol: string
  price: number
  supplied: number
  borrowed: number
  suppliedUsd: number
  borrowedUsd: number
  utilization: number
  supplyApy: number
  borrowApy: number
  loanToValue: number
  liquidationLtv: number
  borrowFactor: number
}

export interface MarketOverview {
  name: string
  reserves: ReserveRow[]
  totalSuppliedUsd: number
  totalBorrowedUsd: number
  utilization: number
  status: MarketStatus
}

export interface Position {
  obligation: string
  exists: boolean
  collateralSol: number
  debtUsdc: number
  collateralValueUsd: number
  debtValueUsd: number
  loanToValue: number
  liquidationLtv: number
  maxLtv: number
  borrowLimitUsd: number
  healthFactor: number | null
  borrowableUsdc: number
  solPrice: number
  usdcPrice: number
  ctokensPerSol: number
}

const rpc = createSolanaRpc(NETWORK.rpcUrl)
let marketCache: { at: number; promise: Promise<KaminoMarket> } | null = null

async function fetchMarket(): Promise<KaminoMarket> {
  const program = address(KLEND_PROGRAM)
  const marketAddress = address(NETWORK.market)
  const state = await LendingMarket.fetch(rpc, marketAddress, program)
  if (!state) throw new Error('Kamino market not found')
  const reserves = new Map<ReturnType<typeof address>, KaminoReserve>()
  for (const reserveAddress of [NETWORK.collateralReserve, NETWORK.debtReserve]) {
    const reserve = await getSingleReserve(address(reserveAddress), rpc, DEFAULT_RECENT_SLOT_DURATION_MS, undefined, undefined, Number(state.reserveRewardsMaxAprBps), program)
    reserves.set(reserve.address, reserve)
  }
  return KaminoMarket.loadWithReserves(rpc, state, reserves, marketAddress, DEFAULT_RECENT_SLOT_DURATION_MS, program)
}

function loadMarket(): Promise<KaminoMarket> {
  if (marketCache && Date.now() - marketCache.at < 60_000) return marketCache.promise
  const promise = fetchMarket()
  marketCache = { at: Date.now(), promise }
  promise.catch(() => {
    marketCache = null
  })
  return promise
}

function decimalsOf(reserve: KaminoReserve): number {
  return 10 ** reserve.stats.decimals
}

function statusOf(market: KaminoMarket): MarketStatus {
  if (market.state.emergencyMode > 0) return 'emergency'
  const debt = market.getReserveByAddress(address(NETWORK.debtReserve))
  const collateral = market.getReserveByAddress(address(NETWORK.collateralReserve))
  if (market.state.borrowDisabled > 0 || !debt || !collateral || debt.state.config.status !== 0 || collateral.state.config.status !== 0) return 'paused'
  return 'active'
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const market = await loadMarket()
  const instant = await getCurrentLedgerInstant(rpc)
  const reserves = [...market.reserves.values()]
    .filter((reserve) => reserve.state.config.status === 0)
    .map((reserve): ReserveRow => {
      const price = reserve.getOracleMarketPrice().toNumber()
      const supplied = reserve.getTotalSupply().div(decimalsOf(reserve)).toNumber()
      const borrowed = reserve.getBorrowedAmount().div(decimalsOf(reserve)).toNumber()
      return {
        address: String(reserve.address),
        mint: String(reserve.getLiquidityMint()),
        symbol: reserve.symbol,
        price,
        supplied,
        borrowed,
        suppliedUsd: supplied * price,
        borrowedUsd: borrowed * price,
        utilization: reserve.calculateUtilizationRatio(),
        supplyApy: reserve.totalSupplyAPY(instant),
        borrowApy: reserve.totalBorrowAPY(instant),
        loanToValue: reserve.stats.loanToValue,
        liquidationLtv: reserve.stats.liquidationThreshold,
        borrowFactor: reserve.stats.borrowFactor / 100,
      }
    })
    .sort((left, right) => right.suppliedUsd - left.suppliedUsd)
  const totalSuppliedUsd = reserves.reduce((sum, row) => sum + row.suppliedUsd, 0)
  const totalBorrowedUsd = reserves.reduce((sum, row) => sum + row.borrowedUsd, 0)
  return {
    name: NETWORK.marketName,
    reserves,
    totalSuppliedUsd,
    totalBorrowedUsd,
    utilization: totalSuppliedUsd > 0 ? totalBorrowedUsd / totalSuppliedUsd : 0,
    status: statusOf(market),
  }
}

export async function getMarketStatus(): Promise<MarketStatus> {
  return statusOf(await loadMarket())
}

export async function getPosition(user: string): Promise<Position> {
  const market = await loadMarket()
  const collateral = market.getReserveByAddress(address(NETWORK.collateralReserve))
  const debt = market.getReserveByAddress(address(NETWORK.debtReserve))
  if (!collateral || !debt) throw new Error('configured reserves are missing from the Kamino market')
  const obligationKey = obligationAddress(KLEND_PROGRAM, NETWORK.market, user).toBase58()
  const instant = await getCurrentLedgerInstant(rpc)
  const obligation = await KaminoObligation.load(market, address(obligationKey), instant)
  const solPrice = collateral.getOracleMarketPrice().toNumber()
  const usdcPrice = debt.getOracleMarketPrice().toNumber()
  const ctokensPerSol = collateral.getCollateralExchangeRate().toNumber()
  const maxLtv = collateral.stats.loanToValue
  const borrowFactor = debt.stats.borrowFactor / 100
  if (!obligation) {
    return { obligation: obligationKey, exists: false, collateralSol: 0, debtUsdc: 0, collateralValueUsd: 0, debtValueUsd: 0, loanToValue: 0, liquidationLtv: collateral.stats.liquidationThreshold, maxLtv, borrowLimitUsd: 0, healthFactor: null, borrowableUsdc: 0, solPrice, usdcPrice, ctokensPerSol }
  }
  const deposit = obligation.getDepositByReserve(address(NETWORK.collateralReserve))
  const borrow = obligation.getBorrowByReserve(address(NETWORK.debtReserve))
  const stats = obligation.refreshedStats
  const adjustedDebt = stats.userTotalBorrowBorrowFactorAdjusted.toNumber()
  const borrowLimitUsd = stats.borrowLimit.toNumber()
  const headroom = Math.max(0, borrowLimitUsd - adjustedDebt)
  return {
    obligation: obligationKey,
    exists: true,
    collateralSol: deposit ? deposit.amount.div(decimalsOf(collateral)).toNumber() : 0,
    debtUsdc: borrow ? borrow.amount.div(decimalsOf(debt)).toNumber() : 0,
    collateralValueUsd: stats.userTotalDeposit.toNumber(),
    debtValueUsd: stats.userTotalBorrow.toNumber(),
    loanToValue: stats.loanToValue.toNumber(),
    liquidationLtv: stats.liquidationLtv.toNumber(),
    maxLtv,
    borrowLimitUsd,
    healthFactor: adjustedDebt > 0 ? stats.borrowLiquidationLimit.toNumber() / adjustedDebt : null,
    borrowableUsdc: (headroom / (usdcPrice * borrowFactor)) * SAFETY_BUFFER,
    solPrice,
    usdcPrice,
    ctokensPerSol,
  }
}
