'use client'

import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const PALETTE = ['#fbbf24', '#60a5fa', '#34d399', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6', '#a3e635', '#94a3b8']

const AXIS = { fontSize: 11, fill: 'var(--color-on-surface-variant)' }
const GRID = 'var(--color-card-border)'

const tooltipStyle = {
  background: 'var(--color-surface-container, #1e293b)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-on-surface)',
}

export function LineSeries({
  data, xKey, yKey, height = 240, label = 'Sessions',
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  yKey: string
  height?: number
  label?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} stroke={GRID} />
        <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey={yKey} name={label} stroke={PALETTE[0]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MultiLineSeries({
  data, xKey, series, height = 240,
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  series: Array<{ key: string; label: string }>
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} stroke={GRID} />
        <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function BarSeries({
  data, xKey, yKey, height = 240, label = '',
}: {
  data: Array<Record<string, unknown>>
  xKey: string
  yKey: string
  height?: number
  label?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} stroke={GRID} />
        <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
        <Bar dataKey={yKey} name={label} fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data, height = 240,
}: {
  data: Array<{ label: string; count: number }>
  height?: number
}) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center text-on-surface-variant text-sm" style={{ height }}>No data</div>
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="label"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
