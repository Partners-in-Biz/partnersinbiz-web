'use client'

import { useId, useMemo, useState } from 'react'

export type TrendSeries = {
  label: string
  color?: string
  /** y-values; nulls render as gaps */
  points: (number | null)[]
  /** when true, smaller y is better (e.g. SERP position) — affects nothing visually, kept for callers */
  invert?: boolean
}

export type TrendChartProps = {
  labels: string[]
  series: TrendSeries[]
  height?: number
  /** force y-axis to start at zero (impressions/clicks). Default true. */
  zeroBased?: boolean
  /** flip the y-axis so smaller values sit higher (SERP position charts) */
  reverseY?: boolean
  yFormat?: (v: number) => string
  className?: string
}

const DEFAULT_COLORS = ['var(--color-pib-accent)', '#60a5fa', '#34d399', '#f472b6', '#fbbf24']

/**
 * Lightweight dependency-free SVG trend chart with hover tooltips.
 * Renders one or more series over a shared categorical x-axis.
 */
export function TrendChart({
  labels,
  series,
  height = 200,
  zeroBased = true,
  reverseY = false,
  yFormat = (v) => v.toLocaleString('en-ZA', { maximumFractionDigits: 1 }),
  className,
}: TrendChartProps) {
  const gradId = useId().replace(/[:]/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const width = 640
  const padL = 44
  const padR = 16
  const padT = 14
  const padB = 26
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const allValues = useMemo(
    () => series.flatMap((s) => s.points).filter((v): v is number => typeof v === 'number'),
    [series],
  )
  const rawMin = allValues.length ? Math.min(...allValues) : 0
  const rawMax = allValues.length ? Math.max(...allValues) : 1
  const min = zeroBased ? Math.min(0, rawMin) : rawMin - (rawMax - rawMin) * 0.1
  const max = rawMax === min ? rawMax + 1 : rawMax + (rawMax - rawMin) * 0.1
  const span = max - min || 1

  const n = labels.length
  const xFor = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW)
  const yFor = (v: number) => {
    const t = (v - min) / span
    const norm = reverseY ? t : 1 - t
    return padT + norm * plotH
  }

  const gridLines = 4
  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => min + (span * i) / gridLines)

  if (!allValues.length) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-[var(--color-pib-line)] bg-black/10 text-xs text-[var(--color-pib-text-muted)] ${className ?? ''}`}
        style={{ height }}
      >
        No data yet
      </div>
    )
  }

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Trend chart"
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color ?? DEFAULT_COLORS[0]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={series[0]?.color ?? DEFAULT_COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => {
          const y = yFor(t)
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--color-pib-line)" strokeWidth="1" opacity="0.4" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-pib-text-muted)">
                {yFormat(t)}
              </text>
            </g>
          )
        })}

        {series.map((s, si) => {
          const color = s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length]
          const segments: string[] = []
          let cur = ''
          s.points.forEach((v, i) => {
            if (typeof v !== 'number') { cur = ''; return }
            const cmd = cur === '' ? 'M' : 'L'
            cur += `${cmd}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)} `
            if (cmd === 'M') segments.push('')
            segments[segments.length - 1] = cur
          })
          const path = segments.join(' ')
          const firstIdx = s.points.findIndex((v) => typeof v === 'number')
          const lastIdx = (() => { for (let i = s.points.length - 1; i >= 0; i--) if (typeof s.points[i] === 'number') return i; return -1 })()
          const area = si === 0 && firstIdx >= 0 && lastIdx >= 0
            ? `${path} L${xFor(lastIdx).toFixed(1)},${(padT + plotH).toFixed(1)} L${xFor(firstIdx).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
            : null
          return (
            <g key={si}>
              {area && <path d={area} fill={`url(#grad-${gradId})`} stroke="none" />}
              <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((v, i) =>
                typeof v === 'number' ? (
                  <circle key={i} cx={xFor(i)} cy={yFor(v)} r={hover === i ? 3.5 : 2} fill={color} />
                ) : null,
              )}
            </g>
          )
        })}

        {labels.map((_, i) => (
          <rect key={i} x={xFor(i) - (plotW / Math.max(n, 1)) / 2} y={padT} width={plotW / Math.max(n, 1)} height={plotH}
            fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}

        {hover !== null && (
          <line x1={xFor(hover)} y1={padT} x2={xFor(hover)} y2={padT + plotH} stroke="var(--color-pib-accent)" strokeWidth="1" opacity="0.4" />
        )}

        {labels.map((label, i) => {
          const show = n <= 8 || i === 0 || i === n - 1 || i === Math.floor(n / 2)
          return show ? (
            <text key={i} x={xFor(i)} y={height - 8} textAnchor="middle" fontSize="9" fill="var(--color-pib-text-muted)">
              {label}
            </text>
          ) : null
        })}
      </svg>

      {hover !== null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-[var(--color-pib-text-muted)]">
          <span className="font-semibold text-[var(--color-pib-text)]">{labels[hover]}</span>
          {series.map((s, si) => {
            const v = s.points[hover]
            return typeof v === 'number' ? (
              <span key={si} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length] }} />
                {s.label}: <span className="tabular-nums text-[var(--color-pib-text)]">{yFormat(v)}</span>
              </span>
            ) : null
          })}
        </div>
      )}

      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-xs text-[var(--color-pib-text-muted)]">
          {series.map((s, si) => (
            <span key={si} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color ?? DEFAULT_COLORS[si % DEFAULT_COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
