import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ConnectModal } from './components/ConnectModal'
import { SHOW_BACKGROUND } from './config'
import { Shell } from './components/Shell'
import { setDisplayLocale } from './lib/format'
import { LangContext, type Lang } from './lib/i18n'
import { WalletProvider } from './lib/wallet'
import { Activity } from './pages/Activity'
import { Dashboard } from './pages/Dashboard'
import { Exchange } from './pages/Exchange'
import { Market } from './pages/Market'
import { Open } from './pages/Open'
import { NotFound } from './pages/NotFound'

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('paralyx.lang') as Lang) || 'tr'
    } catch {
      return 'tr'
    }
  })
  setDisplayLocale(lang === 'tr' ? 'tr-TR' : 'en-US')
  useEffect(() => {
    document.documentElement.classList.toggle('paralyx-bg', SHOW_BACKGROUND)
  }, [])
  const update = (next: Lang) => {
    setLang(next)
    try {
      localStorage.setItem('paralyx.lang', next)
    } catch {
      return
    }
  }
  return (
    <LangContext.Provider value={{ lang, setLang: update }}>
      <WalletProvider>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/open" element={<Open />} />
              <Route path="/exchange" element={<Exchange />} />
              <Route path="/market" element={<Market />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/stats" element={<Activity />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Shell>
          <ConnectModal />
        </BrowserRouter>
      </WalletProvider>
    </LangContext.Provider>
  )
}
