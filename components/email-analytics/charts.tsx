'use client'

// components/email-analytics/charts.tsx
//
// Pure-SVG, dependency-free charts for the email analytics dashboard.
// Dark theme + amber accent. Series are kept simple — { date, value } or
// { label, value }. Layout numbers are intentionally hardcoded so the file
// stays under ~150 lines total.

const AMBER = '#f59e0b'
const AMBER_FADED = 'rgba(245, 158, 11, 0.18)'
const BLUE = '#60a5fa'
const GREEN = '#34d399'
const RED = '#f87171'
const GRID = 'rgba(148, 163, 184, 0.18)'
const TEXT = 'rgba(226, 232, 240, 0.7)'

const PALETTE = [AMBER, BLUE, GREEN, RED, '#a78bfa', '#fb923c']

export interface XYPoint {
  x: string
  y: number
}

export interface LabelValue {
  label: string
  value: number
}

export interface MultiLineSeries {
  name: string
  color?: string
  points: XYPoint[]
}

// ── Line chart ──────────────────────────────────────────────────────────────

export function LineChart({
  series,
  height = 200,
  width = 720,
  yLabel,
}: {
  series: MultiLineSeries[]
  height?: number
  width?: number
  yLabel?: string
}) {
  const pad = { l: 36, r: 12, t: 12, b: 28 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b

  const xs = series[0]?.points.map((p) => p.x) ?? []
  const allY = series.flatMap((s) => s.points.map((p) => p.y))
  const maxY = Math.max(1, ...allY)
  const xStep = xs.length > 1 ? innerW / (xs.length - 1) : innerW

  const scaleY = (y: number) => pad.t + innerH - (y / maxY) * innerH
  const scaleX = (i: number) => pad.l + i * xStep

  const xTickEvery = Math.max(1, Math.ceil(xs.length / 8))

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel ?? 'chart'}>
      {/* y gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <g key={i}>
          <line
            x1={pad.l} x2={pad.l + innerW} y1={pad.t + innerH * t} y2={pad.t + innerH * t}
            stroke={GRID} strokeWidth={1}
          />
          <text x={pad.l - 6} y={pad.t + innerH * t + 4} fontSize={10} textAnchor="end" fill={TEXT}>
            {Math.round(maxY * (1 - t))}
          </text>
        </g>
      ))}

      {/* x labels */}
      {xs.map((x, i) => (i % xTickEvery === 0 ? (
        <text key={x + i} x={scaleX(i)} y={height - 8} fontSize={10} textAnchor="middle" fill={TEXT}>
          {x.length > 7 ? x.slice(5) : x}
        </text>
      ) : null))}

      {/* lines */}
      {series.map((s, idx) => {
        const color = s.color ?? PALETTE[idx % PALETTE.length]
        const d = s.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i)} ${scaleY(p.y)}`)
          .join(' ')
        return <path key={s.name} d={d} fill="none" stroke={color} strokeWidth={2} />
      })}

      {/* legend */}
      <g transform={`translate(${pad.l}, 4)`}>
        {series.map((s, idx) => {
          const color = s.color ?? PALETTE[idx % PALETTE.length]
          return (
            <g key={s.name} transform={`translate(${idx * 90}, 0)`}>
              <rect width={10} height={3} y={6} fill={color} />
              <text x={14} y={10} fontSize={11} fill={TEXT}>{s.name}</text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// ── Bar chart ───────────────────────────────────────────────────────────────

export function BarChart({
  data, height = 200, width = 480,
}: { data: LabelValue[]; height?: number; width?: number }) {
  const pad = { l: 100, r: 12, t: 8, b: 8 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const maxV = Math.max(1, ...data.map((d) => d.value))
  const rowH = data.length > 0 ? innerH / data.length : innerH
  const barH = Math.max(8, rowH - 8)

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
      {data.map((d, i) => {
        const y = pad.t + i * rowH
        const w = (d.value / maxV) * innerW
        return (
          <g key={d.label + i}>
            <text x={pad.l - 8} y={y + barH * 0.75} fontSize={11} textAnchor="end" fill={TEXT}>
              {d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label}
            </text>
            <rect x={pad.l} y={y + (rowH - barH) / 2} width={w} height={barH} fill={AMBER} rx={3} />
            <text x={pad.l + w + 4} y={y + barH * 0.75} fontSize={11} fill={TEXT}>
              {d.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Heatmap cell shade helper ───────────────────────────────────────────────

/**
 * Returns an amber shade for a normalised value 0..1. Used by cohort and
 * send-time grids. Lower = darker background, higher = stronger amber.
 */
export function heatmapShade(value: number): string {
  const t = Math.max(0, Math.min(1, value))
  if (t === 0) return 'rgba(245, 158, 11, 0.06)'
  // Pure CSS rgba so we don't need Tailwind dynamic classes.
  const alpha = 0.1 + t * 0.7
  return `rgba(245, 158, 11, ${alpha.toFixed(3)})`
}

/**
 * Returns the readable text colour to use on top of a heatmap cell — light
 * on dark cells (high values), dim on faint cells (low values).
 */
export function heatmapTextColor(value: number): string {
  return value > 0.5 ? '#0f172a' : 'rgba(226, 232, 240, 0.85)'
}

// ── Horizontal bar with relative + absolute counts ──────────────────────────

export function CountBar({
  label,
  value,
  max,
  rightLabel,
}: {
  label: string
  value: number
  max: number
  rightLabel?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-on-surface truncate" title={label}>
            {label.length > 60 ? label.slice(0, 59) + '…' : label}
          </span>
          <span className="text-on-surface-variant text-xs tabular-nums whitespace-nowrap">
            {rightLabel ?? value.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 mt-1 rounded-full bg-surface-container-high overflow-hidden">
          <div
            className="h-full bg-amber-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Donut chart ─────────────────────────────────────────────────────────────

export function Donut({
  data, size = 180,
}: { data: LabelValue[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = size / 2
  const inner = r * 0.6
  const cx = r
  const cy = r
  let acc = 0

  const arcs = data.map((d, idx) => {
    const startA = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += d.value
    const endA = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = endA - startA > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(startA); const y1 = cy + r * Math.sin(startA)
    const x2 = cx + r * Math.cos(endA);   const y2 = cy + r * Math.sin(endA)
    const xi1 = cx + inner * Math.cos(endA);   const yi1 = cy + inner * Math.sin(endA)
    const xi2 = cx + inner * Math.cos(startA); const yi2 = cy + inner * Math.sin(startA)
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi2} ${yi2} Z`
    return <path key={d.label + idx} d={path} fill={PALETTE[idx % PALETTE.length]} />
  })

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size}>
        {data.length === 0 ? (
          <circle cx={cx} cy={cy} r={r - 2} fill="none" stroke={AMBER_FADED} strokeWidth={2} />
        ) : arcs}
      </svg>
      <ul className="text-xs space-y-1">
        {data.map((d, i) => (
          <li key={d.label + i} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-on-surface-variant">{d.label}</span>
            <span className="text-on-surface tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
