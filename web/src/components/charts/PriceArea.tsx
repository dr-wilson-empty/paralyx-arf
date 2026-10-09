import { useEffect, useRef } from 'react'
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, LineType, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts'

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface AreaPoint {
  t: number
  v: number
}

export interface HoverInfo {
  time: number
  value: number
  candle?: Candle
}

interface Palette {
  ink: string
  mute: string
  line: string
  surface: string
  chart: string
  down: string
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    ink: get('--color-ink', '#111111'),
    mute: get('--color-mute', '#6b6b6b'),
    line: get('--color-line', '#e6e6e6'),
    surface: get('--color-surface', '#ffffff'),
    chart: get('--color-chart', '#7b81ee'),
    down: get('--color-chart-down', '#9a9aa5'),
  }
}

function alpha(hex: string, opacity: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const value = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(value)) return hex
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

const OFFSET_SECONDS = -new Date().getTimezoneOffset() * 60

function toChartTime(ms: number): UTCTimestamp {
  return (Math.floor(ms / 1000) + OFFSET_SECONDS) as UTCTimestamp
}

function fromChartTime(time: Time): number {
  return (Number(time) - OFFSET_SECONDS) * 1000
}

function formatTick(time: Time, dense: boolean, locale: string): string {
  const date = new Date(Number(time) * 1000)
  if (dense) return date.toLocaleTimeString(locale, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString(locale, { timeZone: 'UTC', day: '2-digit', month: 'short' })
}

function formatCrosshair(time: Time, locale: string): string {
  const date = new Date(Number(time) * 1000)
  return date.toLocaleString(locale, { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PriceArea({
  points,
  candles,
  mode,
  stepped = false,
  height = 200,
  format,
  precision = 2,
  locale = 'tr-TR',
  dense = true,
  minSpan = 0,
  onHover,
}: {
  points?: AreaPoint[]
  candles?: Candle[]
  mode: 'area' | 'candles'
  stepped?: boolean
  height?: number
  format: (value: number) => string
  precision?: number
  locale?: string
  dense?: boolean
  minSpan?: number
  onHover?: (info: HoverInfo | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover
  const formatRef = useRef(format)
  formatRef.current = format
  const candleMap = useRef(new Map<number, Candle>())

  useEffect(() => {
    if (!container.current) return
    const palette = readPalette()
    const chart = createChart(container.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: palette.mute,
        fontFamily: 'Sora, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(palette.line, 0.9), style: LineStyle.Solid } },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: alpha(palette.mute, 0.6), width: 1, style: LineStyle.Dashed, labelBackgroundColor: palette.ink },
        horzLine: { color: alpha(palette.mute, 0.6), width: 1, style: LineStyle.Dashed, labelBackgroundColor: palette.ink },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => formatTick(time, dense, locale),
      },
      localization: {
        locale,
        priceFormatter: (price: number) => formatRef.current(price),
        timeFormatter: (time: Time) => formatCrosshair(time, locale),
      },
      handleScroll: false,
      handleScale: false,
    })
    chartRef.current = chart

    const handler = (param: MouseEventParams) => {
      const series = seriesRef.current
      if (!series || !param.time || !param.point) {
        hoverRef.current?.(null)
        return
      }
      const data = param.seriesData.get(series as ISeriesApi<'Area'>)
      if (!data) {
        hoverRef.current?.(null)
        return
      }
      const value = 'value' in data ? (data.value as number) : 'close' in data ? (data.close as number) : null
      if (value === null) {
        hoverRef.current?.(null)
        return
      }
      const time = fromChartTime(param.time)
      hoverRef.current?.({ time, value, candle: candleMap.current.get(time) })
    }
    chart.subscribeCrosshairMove(handler)

    const observer = new MutationObserver(() => {
      const next = readPalette()
      chart.applyOptions({
        layout: { textColor: next.mute },
        grid: { horzLines: { color: alpha(next.line, 0.9) } },
        crosshair: {
          vertLine: { color: alpha(next.mute, 0.6), labelBackgroundColor: next.ink },
          horzLine: { color: alpha(next.mute, 0.6), labelBackgroundColor: next.ink },
        },
      })
      const series = seriesRef.current
      if (series && series.seriesType() === 'Area') {
        ;(series as ISeriesApi<'Area'>).applyOptions({ lineColor: next.chart, topColor: alpha(next.chart, 0.32), bottomColor: alpha(next.chart, 0.02), priceLineColor: next.mute, crosshairMarkerBackgroundColor: next.chart, crosshairMarkerBorderColor: next.surface })
      }
      if (series && series.seriesType() === 'Candlestick') {
        ;(series as ISeriesApi<'Candlestick'>).applyOptions({ upColor: next.chart, downColor: next.down, wickUpColor: next.chart, wickDownColor: next.down, priceLineColor: next.mute })
      }
      volumeRef.current?.applyOptions({ color: alpha(next.chart, 0.25) })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(handler)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      volumeRef.current = null
    }
  }, [height, locale, dense])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const palette = readPalette()
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current)
      seriesRef.current = null
    }
    if (volumeRef.current) {
      chart.removeSeries(volumeRef.current)
      volumeRef.current = null
    }
    const minMove = 1 / 10 ** precision
    const priceFormat = { type: 'custom' as const, formatter: (price: number) => formatRef.current(price), minMove }
    candleMap.current = new Map()
    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } | null; margins?: { above: number; below: number } } | null) => {
      const info = original()
      if (!info || !info.priceRange || minSpan <= 0) return info
      const { minValue, maxValue } = info.priceRange
      const mid = (minValue + maxValue) / 2
      const span = Math.max(maxValue - minValue, Math.abs(mid) * minSpan)
      return { ...info, priceRange: { minValue: mid - span / 2, maxValue: mid + span / 2 } }
    }

    if (mode === 'candles' && candles && candles.length > 0) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: palette.chart,
        downColor: palette.down,
        borderVisible: false,
        wickUpColor: palette.chart,
        wickDownColor: palette.down,
        priceLineVisible: true,
        priceLineColor: palette.mute,
        priceLineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        priceFormat,
      })
      const volume = chart.addSeries(HistogramSeries, {
        color: alpha(palette.chart, 0.25),
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      })
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, borderVisible: false })
      const sorted = [...candles].sort((a, b) => a.t - b.t)
      const seen = new Set<number>()
      const bars = sorted.filter((candle) => {
        if (seen.has(candle.t)) return false
        seen.add(candle.t)
        candleMap.current.set(candle.t, candle)
        return true
      })
      series.setData(bars.map((candle) => ({ time: toChartTime(candle.t), open: candle.o, high: candle.h, low: candle.l, close: candle.c })))
      volume.setData(bars.map((candle) => ({ time: toChartTime(candle.t), value: candle.v, color: candle.c >= candle.o ? alpha(palette.chart, 0.35) : alpha(palette.down, 0.35) })))
      seriesRef.current = series
      volumeRef.current = volume
    } else {
      const source = points && points.length > 0 ? points : (candles ?? []).map((candle) => ({ t: candle.t, v: candle.c }))
      if (candles) for (const candle of candles) candleMap.current.set(candle.t, candle)
      const series = chart.addSeries(AreaSeries, {
        lineColor: palette.chart,
        topColor: alpha(palette.chart, 0.32),
        bottomColor: alpha(palette.chart, 0.02),
        lineWidth: 2,
        lineType: stepped ? LineType.WithSteps : LineType.Simple,
        priceLineVisible: true,
        priceLineColor: palette.mute,
        priceLineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: palette.chart,
        crosshairMarkerBorderColor: palette.surface,
        crosshairMarkerBorderWidth: 2,
        priceFormat,
        autoscaleInfoProvider,
      })
      const sorted = [...source].sort((a, b) => a.t - b.t)
      const seen = new Set<number>()
      const rows = sorted.filter((point) => {
        const key = Math.floor(point.t / 1000)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      series.setData(rows.map((point) => ({ time: toChartTime(point.t), value: point.v })))
      seriesRef.current = series
    }
    chart.timeScale().fitContent()
  }, [points, candles, mode, stepped, precision, minSpan])

  return <div ref={container} className="w-full" style={{ height }} />
}
