import { ExchangeCard, RailPendingCard } from '../components/ExchangeCard'
import { History } from '../components/exchange/History'
import { HAS_SANDBOX_RAIL } from '../config'
import { LineCard } from '../components/cards'
import { useT } from '../lib/i18n'
import { useShared } from '../lib/useShared'

export function Exchange() {
  const { t } = useT()
  const shared = useShared()
  return (
    <div>
      <section className="pb-6">
        <h1 className="text-3xl tracking-tight text-ink sm:text-4xl">{t('exchangeTitleLong')}</h1>
        <p className="mt-2 max-w-2xl text-base text-mute">{HAS_SANDBOX_RAIL ? t('cashBody') : t('exchangeBodyMainnet')}</p>
      </section>
      <section className="grid gap-5 lg:grid-cols-5 *:min-w-0">
        <div className="space-y-5 lg:col-span-3">
          {HAS_SANDBOX_RAIL ? <ExchangeCard {...shared} /> : <RailPendingCard />}
          <History address={shared.signer?.address ?? null} />
        </div>
        <div className="space-y-5 lg:col-span-2">
          <LineCard {...shared} />
        </div>
      </section>
    </div>
  )
}
