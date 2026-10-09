import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Activity, ArrowDownToLine, Code2, LayoutDashboard, LineChart, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { IS_MAINNET, NETWORKS, NETWORK_ID, PROGRAM_ID, addressLink, switchNetwork, type NetworkId } from '../config'
import { getActivity, getLineCount } from '../lib/solana'
import { useT, type DictKey } from '../lib/i18n'
import { getSolUsdHistory, getTryPerUsdHistory } from '../lib/prices'
import { load, useInflight } from '../lib/store'
import { useTheme } from '../lib/theme'
import { useWallet } from '../lib/wallet'
import { MotionButton } from './MotionButton'
import { WalletMenu } from './Header'

interface Item {
  to: string
  label: DictKey
  icon: typeof LayoutDashboard
}

const main: Item[] = [
  { to: '/', label: 'navDashboard', icon: LayoutDashboard },
  { to: '/market', label: 'navMarket', icon: LineChart },
  { to: '/activity', label: 'navActivity', icon: Activity },
]

const explore: Item[] = [
  { to: '/open', label: 'navOpen', icon: ArrowDownToLine },
  { to: '/exchange', label: 'navExchange', icon: RefreshCw },
]

const SIDEBAR_KEY = 'paralyx.sidebar'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function prefetch(path: string): void {
  if (path === '/market') void load('overview', () => import('../lib/kamino').then((module) => module.getMarketOverview()), { ttl: 60_000, persist: true }).catch(() => undefined)
  if (path === '/activity' && PROGRAM_ID) {
    void load('events', getActivity, { ttl: 20_000, persist: true }).catch(() => undefined)
    void load('lineCount', getLineCount, { ttl: 30_000, persist: true }).catch(() => undefined)
  }
  if (path === '/') {
    void load('chart:try', getTryPerUsdHistory, { ttl: 120_000, persist: true }).catch(() => undefined)
    void load('chart:sol:24h', () => getSolUsdHistory('24h'), { ttl: 60_000, persist: true }).catch(() => undefined)
  }
}

function NavItem({ item, collapsed }: { item: Item; collapsed: boolean }) {
  const { t } = useT()
  const Icon = item.icon
  const label = t(item.label)
  return (
    <NavLink to={item.to} end={item.to === '/'} onMouseEnter={() => prefetch(item.to)} onFocus={() => prefetch(item.to)} title={collapsed ? label : undefined}>
      {({ isActive }) => (
        <motion.span
          whileHover={{ x: collapsed ? 0 : 2 }}
          whileTap={{ scale: 0.98 }}
          className={
            'flex items-center gap-3 rounded-2xl py-2.5 text-sm transition ' +
            (collapsed ? 'justify-center px-0' : 'px-3 ') +
            (isActive ? 'bg-accent text-on-accent' : 'text-mute hover:bg-soft hover:text-ink')
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {collapsed ? null : label}
        </motion.span>
      )}
    </NavLink>
  )
}

function titleFor(pathname: string, t: (key: DictKey) => string): string {
  const map: Record<string, DictKey> = { '/': 'navDashboard', '/market': 'navMarket', '/activity': 'navActivity', '/open': 'navOpen', '/exchange': 'navExchange' }
  const key = map[pathname]
  return key ? `Paralyx · ${t(key)}` : 'Paralyx'
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useT()
  const { address, openConnect } = useWallet()
  const { theme, toggle } = useTheme()
  const inflight = useInflight()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())

  useEffect(() => {
    window.scrollTo({ top: 0 })
    document.title = titleFor(location.pathname, t)
  }, [location.pathname, t])

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        return next
      }
      return next
    })
  }

  return (
    <div className="min-h-screen text-ink">
      <aside
        className={
          'fixed inset-y-0 left-0 hidden flex-col border-r border-line bg-surface/85 py-6 backdrop-blur transition-[width,padding] duration-200 lg:flex ' +
          (collapsed ? 'w-[4.5rem] px-2' : 'w-60 px-4')
        }
      >
        <NavLink to="/" className={'flex items-center gap-2.5 text-xl tracking-tight text-ink ' + (collapsed ? 'justify-center px-0' : 'px-3')} title="Paralyx">
          <img src="/brand/paralyx-mark-256.png" alt="" className="h-7 w-7 shrink-0 dark:invert" draggable={false} />
          {collapsed ? null : 'Paralyx'}
        </NavLink>
        <div className="mt-8 space-y-1">
          {main.map((item) => (
            <NavItem key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
        {collapsed ? <div className="mx-auto mt-6 h-px w-8 bg-line" /> : <div className="mt-8 px-3 text-xs text-mute">{t('navExplore')}</div>}
        <div className="mt-2 space-y-1">
          {explore.map((item) => (
            <NavItem key={item.to} item={item} collapsed={collapsed} />
          ))}
        </div>
        <div className={'mt-auto space-y-3 ' + (collapsed ? 'px-0' : 'px-3')}>
          {collapsed ? null : <span className="pill">{IS_MAINNET ? t('mainnetNotice') : t('devnet')}</span>}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? t('expand') : t('collapse')}
            aria-label={collapsed ? t('expand') : t('collapse')}
            className={'flex items-center gap-2 rounded-2xl py-2 text-xs text-mute transition hover:bg-soft hover:text-ink ' + (collapsed ? 'w-full justify-center' : 'px-3')}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {collapsed ? null : t('collapse')}
          </button>
        </div>
      </aside>

      <div className={'transition-[padding] duration-200 ' + (collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-60')}>
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
          <NavLink to="/" className="flex items-center gap-2 text-lg tracking-tight text-ink lg:hidden">
            <img src="/brand/paralyx-mark-256.png" alt="" className="h-6 w-6 dark:invert" draggable={false} />
            Paralyx
          </NavLink>
          <div className="hidden items-center gap-3 text-sm text-mute lg:flex">
            <span>{t('tagline')}</span>
            {inflight > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="live-dot" /> {t('updating')}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-full border border-line p-0.5 text-xs">
              {(Object.keys(NETWORKS) as NetworkId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => id !== NETWORK_ID && switchNetwork(id)}
                  className={'rounded-full px-2.5 py-1 transition ' + (NETWORK_ID === id ? 'bg-accent text-on-accent' : 'text-mute hover:text-ink')}
                >
                  {NETWORKS[id].label}
                </button>
              ))}
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={toggle}
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute transition hover:border-accent-strong hover:text-ink"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-mute transition hover:border-accent-strong hover:text-ink"
            >
              {lang === 'tr' ? 'EN' : 'TR'}
            </motion.button>
            {address ? <WalletMenu /> : <MotionButton onClick={openConnect}>{t('connect')}</MotionButton>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-5 pb-28 pt-6 lg:pb-16">{children}</main>
        <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-5 text-xs text-mute">
          <span>{t('footerBuilt')}</span>
          <div className="flex flex-wrap items-center gap-4">
            <a className="inline-flex items-center gap-1.5 hover:text-ink" href="https://github.com/wienerlabs/paralyx" target="_blank" rel="noreferrer">
              <Code2 className="h-3.5 w-3.5" /> GitHub
            </a>
            {PROGRAM_ID ? (
              <a className="hover:text-ink" href={addressLink(PROGRAM_ID)} target="_blank" rel="noreferrer">
                {t('contract')} · {PROGRAM_ID.slice(0, 6)}…{PROGRAM_ID.slice(-4)}
              </a>
            ) : null}
            <span>{IS_MAINNET ? 'Solana mainnet' : 'Solana devnet'}</span>
          </div>
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-line bg-surface/95 px-2 py-2 backdrop-blur lg:hidden">
        {[...main, ...explore].map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="flex-1">
              {({ isActive }) => (
                <span className={'flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] ' + (isActive ? 'text-ink' : 'text-mute')}>
                  <span className={'inline-flex h-7 w-7 items-center justify-center rounded-full ' + (isActive ? 'bg-accent text-on-accent' : '')}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {t(item.label)}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
