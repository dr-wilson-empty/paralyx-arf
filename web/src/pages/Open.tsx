import { LineCard, OpenCard, WalletCard, WithdrawCard } from '../components/cards'
import { KaminoMark, TokenIcon } from '../components/TokenIcon'
import { useT, type DictKey } from '../lib/i18n'
import { useShared } from '../lib/useShared'

export function Open() {
  const { t } = useT()
  const shared = useShared()
  return (
    <div>
      <section className="pb-6">
        <h1 className="text-3xl tracking-tight text-ink sm:text-4xl">{t('openTitleLong')}</h1>
        <p className="mt-2 max-w-2xl text-base text-mute">{t('openBody')}</p>
      </section>
      <section className="grid gap-5 lg:grid-cols-5 *:min-w-0">
        <div className="space-y-5 lg:col-span-3">
          <WalletCard {...shared} />
          <OpenCard {...shared} />
          <WithdrawCard {...shared} />
        </div>
        <div className="space-y-5 lg:col-span-2">
          <LineCard {...shared} />
          <div className="card">
            <h3 className="text-lg text-ink">{t('soonTitle')}</h3>
            <ul className="mt-3 space-y-3 text-sm text-mute">
              <li className="flex gap-3">
                <TokenIcon symbol="TRY" size={20} className="mt-0.5" />
                <span>{t('soonBilira')}</span>
              </li>
              <li className="flex gap-3">
                <TokenIcon symbol="SOL" size={20} className="mt-0.5" />
                <span>{t('soonMainnet')}</span>
              </li>
              <li className="flex gap-3">
                <TokenIcon symbol="USDC" size={20} className="mt-0.5" />
                <span>{t('soonCctp')}</span>
              </li>
              <li className="flex gap-3">
                <KaminoMark size={18} className="mt-0.5 w-5 justify-center" />
                <span>{t('soonGuardian')}</span>
              </li>
            </ul>
          </div>
          <div className="card">
            <h3 className="text-lg text-ink">{t('how')}</h3>
            <ol className="mt-3 space-y-2 text-sm text-mute">
              {(['how1', 'how2', 'how3', 'how4'] as DictKey[]).map((key, index) => (
                <li key={key} className="flex gap-3">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-ink">{index + 1}</span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  )
}
