import { HAS_SANDBOX_RAIL } from '../config'
import { getArfFacility } from './rail'
import { load, useCached } from './store'

const KEY = 'arf'

export function useArfFacility() {
  return useCached(HAS_SANDBOX_RAIL ? KEY : null, getArfFacility, { ttl: 15_000, persist: true, refreshMs: 30_000 })
}

export function refreshArf(): void {
  if (HAS_SANDBOX_RAIL) load(KEY, getArfFacility, { persist: true, force: true }).catch(() => undefined)
}
