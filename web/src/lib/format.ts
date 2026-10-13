let displayLocale = 'tr-TR'

export function setDisplayLocale(locale: string): void {
  displayLocale = locale
}

export function formatAmount(n: number, decimals = 2): string {
  return n.toLocaleString(displayLocale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatClock(time: number, options?: Intl.DateTimeFormatOptions): string {
  return new Date(time).toLocaleTimeString(displayLocale, options)
}

export function formatDateTime(time: number): string {
  return new Date(time).toLocaleString(displayLocale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
