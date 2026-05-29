'use client'

import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

// ── Theme constants ──────────────────────────────────────────────────────

const COLORS = {
  accent: '#F59E0B',
  accentDim: 'rgba(245,158,11,0.3)',
  grey: '#2a2a2a',
  greyLight: '#3a3a3a',
  text: '#e2e2e2',
  textDim: '#999',
  bg: '#0A0A0A',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
  red: '#ef4444',
  purple: '#a78bfa',
  cyan: '#22d3ee',
}

const DONUT_PALETTE = [COLORS.accent, COLORS.green, COLORS.blue, COLORS.pink, COLORS.purple, COLORS.cyan, COLORS.red]
const DEFAULT_CHART_WIDTH = 320

// ── Custom Tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="pib-card !p-2 !text-xs !shadow-lg border border-[var(--color-card-border)]">
      {label && <p className="text-on-surface-variant mb-1">{label}</p>}
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-on-surface font-medium" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

// ── Stat Card with inline mini chart ─────────────────────────────────────

interface StatCardWithChartProps {
  label: string
  value: string | number
  sub?: string
  trend?: 'up' | 'down'
  accent?: boolean
  data?: { value: number }[]
  chartType?: 'bar' | 'area'
}

export function StatCardWithChart({
  label, value, sub, trend, accent, data, chartType = 'bar',
}: StatCardWithChartProps) {
  return (
    <div className="pib-stat-card flex items-end justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2">
          {label}
        </p>
        <p
          className="text-3xl font-headline font-bold mb-1"
          style={{ color: accent ? COLORS.accent : COLORS.text }}
        >
          {value}
        </p>
        {sub && (
          <p className="text-xs text-on-surface-variant flex items-center gap-1">
            {trend === 'up' && <span className="text-green-400 text-xs">↑</span>}
            {trend === 'down' && <span className="text-red-400 text-xs">↓</span>}
            {sub}
          </p>
        )}
      </div>
      {data && data.length > 0 && (
        <div className="w-24 h-14 shrink-0">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 96, height: 56 }}>
            {chartType === 'area' ? (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="accentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS.accent}
                  strokeWidth={2}
                  fill="url(#accentGradient)"
                  dot={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={data}>
                <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === data.length - 1 ? COLORS.accent : COLORS.grey}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Revenue-style Bar Chart ──────────────────────────────────────────────

interface RevenueBarChartProps {
  data: { label: string; value: number }[]
  target?: number
  valueFormatter?: (v: number) => string
  height?: number
  highlightLast?: boolean
}

export function RevenueBarChart({
  data, target, valueFormatter, height = 250, highlightLast = true,
}: RevenueBarChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: COLORS.textDim }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: COLORS.textDim }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
          width={60}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={false} />
        {target && (
          <ReferenceLine
            y={target}
            stroke={COLORS.textDim}
            strokeDasharray="6 3"
            label={{
              value: fmt(target),
              position: 'right',
              fill: COLORS.textDim,
              fontSize: 10,
            }}
          />
        )}
        <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Revenue">
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={highlightLast && i === data.length - 1 ? COLORS.accent : COLORS.greyLight}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Trend Area Chart ─────────────────────────────────────────────────────

interface TrendAreaChartProps {
  data: { label: string; value: number }[]
  height?: number
  color?: string
  valueFormatter?: (v: number) => string
}

export function TrendAreaChart({
  data, height = 200, color = COLORS.accent, valueFormatter,
}: TrendAreaChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())
  const gradientId = `area-grad-${color.replace('#', '')}`

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: COLORS.textDim }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: COLORS.textDim }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
          width={50}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          name="Value"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Donut Chart ──────────────────────────────────────────────────────────

interface DonutChartProps {
  data: { name: string; value: number; color?: string }[]
  height?: number
  innerRadius?: number
  outerRadius?: number
  centerLabel?: string
  centerValue?: string | number
}

export function DonutChart({
  data, height = 220, innerRadius = 55, outerRadius = 80, centerLabel, centerValue,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && (
            <span className="text-2xl font-headline font-bold text-on-surface">{centerValue}</span>
          )}
          {centerLabel && (
            <span className="text-[10px] text-on-surface-variant uppercase tracking-wide">{centerLabel}</span>
          )}
        </div>
      )}
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
        {data.map((entry, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: entry.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length] }}
            />
            <span className="text-[10px] text-on-surface-variant">
              {entry.name} ({entry.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal Bar Chart ─────────────────────────────────────────────────

interface HorizontalBarChartProps {
  data: { label: string; value: number; color?: string }[]
  height?: number
  valueFormatter?: (v: number) => string
}

export function HorizontalBarChart({
  data, height, valueFormatter,
}: HorizontalBarChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())
  const chartHeight = height ?? Math.max(data.length * 40, 120)

  return (
    <ResponsiveContainer width="100%" height={chartHeight} initialDimension={{ width: DEFAULT_CHART_WIDTH, height: chartHeight }}>
      <BarChart data={data} layout="vertical" barCategoryGap="25%">
        <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.04)" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: COLORS.textDim }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 12, fill: COLORS.text }}
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={false} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Value">
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
