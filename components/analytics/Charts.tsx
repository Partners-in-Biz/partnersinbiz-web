'use client'

import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

/** Terracotta for the primary series; ink-soft for the rest (brand 11.11). */
const PRIMARY = 'var(--sc-accent)'
const REST = 'var(--sc-ink-soft)'
const PALETTE = [PRIMARY, REST, REST, REST, REST, REST, REST, REST, REST, REST]

const AXIS_TICK = {
  className: 'sc-tiny',
  fill: 'var(--sc-ink-soft)',
  fontSize: 11,
} as const
const GRID = 'var(--sc-line)'

const tooltipStyle = {
  background: 'var(--sc-surface)',
  border: '1px solid var(--sc-line)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--sc-ink)',
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
        <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line type="monotone" dataKey={yKey} name={label} stroke={PRIMARY} strokeWidth={2} dot={false} />
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
        <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} className="sc-tiny" />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={i === 0 ? PRIMARY : REST}
            strokeWidth={2}
            dot={false}
          />
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
        <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'color-mix(in srgb, var(--sc-ink) 4%, transparent)' }} />
        <Bar dataKey={yKey} name={label} fill={PRIMARY} radius={[4, 4, 0, 0]} />
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
    return <div className="flex items-center justify-center sc-body text-[var(--sc-ink-soft)] text-sm" style={{ height }}>No data</div>
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
        <Legend wrapperStyle={{ fontSize: 11 }} className="sc-tiny" />
      </PieChart>
    </ResponsiveContainer>
  )
}
